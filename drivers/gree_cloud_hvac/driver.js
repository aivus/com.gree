'use strict';

const Homey = require('homey');
const session = require('./network/session');
const { REGION_IDS } = require('./network/rest');
const { CloudError, ERROR } = require('./network/errors');

// Region offered first, and the default selection in the pairing view.
const DEFAULT_REGION = 'europe';

// App setting holding one record per Gree account, keyed by accountKey().
const ACCOUNTS_SETTING = 'cloud_accounts';

class GreeCloudHVACDriver extends Homey.Driver {

    async onInit() {
        this.log('GreeCloudHVACDriver has been inited');
        this._session = session;
    }

    /**
     * App is shutting down. Close every cloud connection so no broker socket or
     * timer outlives the app.
     */
    async onUninit() {
        this.log('GreeCloudHVACDriver is uninitializing. Stopping cloud session.');
        this._session.stop();
    }

    /**
     * Translate a transport error into a message the user can act on. Cloud
     * errors never carry credentials, but an unexpected error might, so only
     * known reasons are surfaced.
     *
     * @param {Error} error
     * @returns {Error}
     * @private
     */
    _localizeError(error) {
        if (error instanceof CloudError && Object.values(ERROR).includes(error.reason)) {
            this.log('[cloud]', 'request failed:', error.reason, error.message);

            return new Error(this.homey.__(`error.cloud.${error.reason}`));
        }

        this.error('[cloud]', 'unexpected failure', error);

        return new Error(this.homey.__('error.cloud.cloud'));
    }

    /**
     * The region list for the pairing and repair views, localised here so the
     * views do not have to duplicate it.
     *
     * @param {string} [selected] Region to pre-select
     * @returns {Array<{id: string, label: string, selected: boolean}>}
     * @private
     */
    _regionChoices(selected = DEFAULT_REGION) {
        return REGION_IDS.map((id) => ({
            id,
            label: this.homey.__(`pair.cloud.regions.${id}`),
            selected: id === selected,
        }));
    }

    /**
     * Read the stored account records.
     *
     * @returns {object}
     * @private
     */
    _getAccounts() {
        return this.homey.settings.get(ACCOUNTS_SETTING) || {};
    }

    /**
     * Persist an account record. Credentials are stored so the app can sign in
     * again unattended: the cloud has no refresh mechanism and expires sessions
     * on its own schedule, so the alternative is a device that goes offline
     * until the user repairs it by hand.
     *
     * @param {string} key accountKey()
     * @param {object} record
     * @private
     */
    _saveAccount(key, record) {
        this.homey.settings.set(ACCOUNTS_SETTING, {
            ...this._getAccounts(),
            [key]: record,
        });
    }

    /**
     * Turn a cloud device into a Homey device descriptor.
     *
     * @param {object} cloudDevice Raw device from the cloud device list
     * @param {object} context
     * @param {string} context.accountKey
     * @param {string} context.region
     * @param {string} context.email
     * @returns {object}
     * @private
     */
    _toDeviceDescriptor(cloudDevice, { accountKey, region, email }) {
        const mac = String(cloudDevice.mac);

        return {
            name: cloudDevice.name || mac,
            // Immutable identity. The MAC is duplicated here so getMac() works
            // the same way as in the local driver.
            data: {
                id: mac,
                mac,
            },
            // Mutable machine state. The per-device key is rotated by the cloud,
            // so it cannot live in `data`.
            store: {
                mac,
                key: cloudDevice.key,
                region,
                account_key: accountKey,
                home_id: cloudDevice.homeId !== undefined ? cloudDevice.homeId : null,
                version: cloudDevice.ver || null,
                model: cloudDevice.model || null,
            },
            settings: {
                account_email: email,
                account_region: this.homey.__(`pair.cloud.regions.${region}`),
                device_mac: mac,
            },
        };
    }

    async onPair(session_) {
        // Devices found during this pairing session, and the account they
        // belong to. Mirrors how the local driver keeps its static devices.
        let discovered = [];
        let context = null;

        session_.setHandler('get_regions', async () => this._regionChoices());

        session_.setHandler('login', async ({ region, email, password }) => {
            const credentials = this._validateCredentials({ region, email, password });

            let account;
            let devices;
            try {
                ({ account, devices } = await this._session.signIn({
                    region: credentials.region,
                    username: credentials.email,
                    password: credentials.password,
                    logger: this,
                }));
            } catch (error) {
                throw this._localizeError(error);
            }

            if (devices.length === 0) {
                throw new Error(this.homey.__('error.cloud.no_devices'));
            }

            const key = session.accountKey(credentials.region, credentials.email);

            this._saveAccount(key, {
                region: credentials.region,
                email: credentials.email,
                password: credentials.password,
                account,
            });

            context = { accountKey: key, region: credentials.region, email: credentials.email };
            discovered = devices;

            return { deviceCount: devices.length };
        });

        session_.setHandler('list_devices', async () => {
            if (!context) {
                return [];
            }

            const paired = new Set(this.getDevices().map((device) => device.getMac()));

            return discovered
                // A device without a key cannot be talked to at all.
                .filter((device) => Boolean(device.key))
                .filter((device) => !paired.has(String(device.mac)))
                .map((device) => this._toDeviceDescriptor(device, context));
        });
    }

    async onRepair(session_, device) {
        session_.setHandler('get_regions', async () => this._regionChoices(
            device.getStoreValue('region') || DEFAULT_REGION,
        ));

        // Deliberately returns no password: the view prefills what is safe to
        // show and the user re-enters the secret.
        session_.setHandler('get_account', async () => ({
            email: device.getSetting('account_email') || '',
            region: device.getStoreValue('region') || DEFAULT_REGION,
        }));

        session_.setHandler('relogin', async ({ region, email, password }) => {
            const credentials = this._validateCredentials({ region, email, password });

            let account;
            let devices;
            try {
                ({ account, devices } = await this._session.signIn({
                    region: credentials.region,
                    username: credentials.email,
                    password: credentials.password,
                    logger: this,
                }));
            } catch (error) {
                throw this._localizeError(error);
            }

            const mac = device.getMac();
            const match = devices.find((candidate) => String(candidate.mac) === String(mac));

            if (!match) {
                throw new Error(this.homey.__('repair.cloud.device_not_found'));
            }

            if (!match.key) {
                throw new Error(this.homey.__('error.cloud.missing_key'));
            }

            const key = session.accountKey(credentials.region, credentials.email);

            // Drop any connection still using the old credentials, so the
            // device reconnects with what the user just entered.
            this._session.release(credentials.region, credentials.email);
            const previousRegion = device.getStoreValue('region');
            const previousEmail = device.getSetting('account_email');
            if (previousEmail && (previousRegion !== credentials.region || previousEmail !== credentials.email)) {
                this._session.release(previousRegion, previousEmail);
            }

            this._saveAccount(key, {
                region: credentials.region,
                email: credentials.email,
                password: credentials.password,
                account,
            });

            await device.setStoreValue('key', match.key);
            await device.setStoreValue('region', credentials.region);
            await device.setStoreValue('account_key', key);
            await device.setSettings({
                account_email: credentials.email,
                account_region: this.homey.__(`pair.cloud.regions.${credentials.region}`),
            });

            await device.reconnect();

            return true;
        });
    }

    /**
     * Validate and normalise what the user typed.
     *
     * @param {object} input
     * @returns {{region: string, email: string, password: string}}
     * @private
     */
    _validateCredentials({ region, email, password }) {
        if (!REGION_IDS.includes(region)) {
            throw new Error(this.homey.__('error.cloud.wrong_region'));
        }

        const trimmedEmail = typeof email === 'string' ? email.trim() : '';

        if (!trimmedEmail || !password) {
            throw new Error(this.homey.__('error.cloud.invalid_credentials'));
        }

        return { region, email: trimmedEmail, password };
    }

}

module.exports = GreeCloudHVACDriver;
module.exports.ACCOUNTS_SETTING = ACCOUNTS_SETTING;
module.exports.DEFAULT_REGION = DEFAULT_REGION;
