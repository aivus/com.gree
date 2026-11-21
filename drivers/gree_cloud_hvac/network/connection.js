'use strict';

const { CloudRestClient } = require('./rest');
const { CloudMqttClient, deduplicateDevices } = require('./mqtt');
const { CloudError, ERROR } = require('./errors');

/**
 * Everything belonging to one Gree account: the REST client, one MQTT
 * connection, and the devices sharing it.
 *
 * A Gree account allows a single active session, so opening one connection per
 * device would make the account fight itself. Every device on the same account
 * therefore shares this object, and the connection is closed once the last of
 * them detaches.
 *
 * The cloud gives no way to refresh a token and does not document how long one
 * lives, so an expired session is handled by signing in again and retrying the
 * failed call exactly once.
 */

class CloudConnection {

    /**
     * @param {object} options
     * @param {string} options.region
     * @param {string} options.username
     * @param {string} options.password
     * @param {object} [options.account] Previously stored {uid, token}
     * @param {object} [options.logger] Object with log()/error()
     * @param {object} [options.clientOptions] Passed to CloudMqttClient
     * @param {Function} [options.createRestClient] For tests
     * @param {Function} [options.createMqttClient] For tests
     * @param {Function} [options.onAccountChange] Called with {uid, token}
     *        whenever a new token is obtained, so it can be persisted
     */
    constructor({
        region,
        username,
        password,
        account = null,
        logger,
        clientOptions = {},
        createRestClient,
        createMqttClient,
        onAccountChange,
    }) {
        this._region = region;
        this._username = username;
        this._password = password;
        this._account = account;
        this._logger = logger || { log() {}, error() {} };
        this._clientOptions = clientOptions;
        this._onAccountChange = onAccountChange || (() => {});

        this._createRestClient = createRestClient
            || ((options) => new CloudRestClient(options));
        this._createMqttClient = createMqttClient
            || ((options) => new CloudMqttClient(options));

        this._rest = this._createRestClient({ region, logger: this._logger });
        this._mqtt = null;

        /**
         * In-flight connect, so concurrent devices share one handshake.
         *
         * @type {Promise<void>|null}
         * @private
         */
        this._connecting = null;

        /**
         * Devices attached to this connection, keyed by MAC. Kept here rather
         * than only in the MQTT client so they can be re-attached after the
         * connection is rebuilt.
         *
         * @type {Map<string, object>}
         * @private
         */
        this._attached = new Map();
    }

    get region() {
        return this._region;
    }

    get account() {
        return this._account;
    }

    get connected() {
        return Boolean(this._mqtt && this._mqtt.connected);
    }

    get references() {
        return this._attached.size;
    }

    /**
     * Sign in, unless a usable token is already known.
     *
     * @param {boolean} [force] Sign in again even if a token is known
     * @returns {Promise<{uid: number, token: string}>}
     */
    async authenticate(force = false) {
        if (this._account && !force) {
            return this._account;
        }

        this._logger.log('[cloud]', 'signing in to the Gree cloud');
        this._account = await this._rest.login(this._username, this._password);
        this._onAccountChange(this._account);

        return this._account;
    }

    /**
     * List the devices this account can reach, across every home.
     *
     * @returns {Promise<Array<object>>} Raw device objects, deduplicated
     */
    async listDevices() {
        return this._withReauthentication(async () => {
            const account = await this.authenticate();
            const homes = await this._rest.getHomes(account);

            const devices = [];
            for (const home of homes) {
                // Sequentially on purpose: the cloud is rate limited and a home
                // count is small enough that parallelism buys nothing.
                // eslint-disable-next-line no-await-in-loop
                const homeDevices = await this._rest.getDevices(account, home.id);

                homeDevices.forEach((device) => {
                    devices.push({ ...device, homeId: home.id, homeName: home.name });
                });
            }

            return deduplicateDevices(devices);
        });
    }

    /**
     * Open the MQTT connection, reusing an in-flight handshake.
     *
     * @returns {Promise<void>}
     */
    connect() {
        if (this.connected) {
            return Promise.resolve();
        }

        if (!this._connecting) {
            this._connecting = this._connect().finally(() => {
                this._connecting = null;
            });
        }

        return this._connecting;
    }

    /**
     * @returns {Promise<void>}
     * @private
     */
    async _connect() {
        await this._withReauthentication(async () => {
            const account = await this.authenticate();
            const { host, port } = await this._rest.getMqttAddress(account);

            this._logger.log('[cloud]', 'connecting to broker', `${host}:${port}`);

            this._mqtt = this._createMqttClient({
                host,
                port,
                uid: account.uid,
                token: account.token,
                logger: this._logger,
                ...this._clientOptions,
            });

            await this._mqtt.connect();

            // A rebuilt client starts with no devices, so restore the ones that
            // were attached before the connection dropped.
            for (const device of this._attached.values()) {
                // eslint-disable-next-line no-await-in-loop
                await this._mqtt.attachDevice(device);
            }
        });
    }

    /**
     * Attach a device to this connection.
     *
     * @param {object} device
     * @param {string} device.mac
     * @param {string} device.key
     * @param {Function} device.onProperties
     * @returns {Promise<void>}
     */
    async attachDevice(device) {
        this._attached.set(device.mac, device);

        try {
            await this.connect();
            await this._mqtt.attachDevice(device);
        } catch (error) {
            // Leave no half-attached device behind, or the connection would be
            // kept alive by something that never works.
            this._attached.delete(device.mac);

            if (this._attached.size === 0) {
                this.disconnect();
            }

            throw error;
        }
    }

    /**
     * Detach a device, closing the connection when it was the last one.
     *
     * @param {string} mac
     */
    detachDevice(mac) {
        if (this._mqtt) {
            this._mqtt.detachDevice(mac);
        }

        this._attached.delete(mac);

        if (this._attached.size === 0) {
            this.disconnect();
        }
    }

    /**
     * Read the given vendor property codes from a device.
     *
     * @param {string} mac
     * @param {string[]} cols
     * @returns {Promise<{cols: string[], dat: Array<string|number>}>}
     */
    async getStatus(mac, cols) {
        return this._withReconnect(() => this._mqtt.getStatus(mac, cols));
    }

    /**
     * Write vendor properties to a device.
     *
     * @param {string} mac
     * @param {Object<string, string|number>} vendorProperties
     * @returns {Promise<object>}
     */
    async setProperties(mac, vendorProperties) {
        return this._withReconnect(() => this._mqtt.setProperties(mac, vendorProperties));
    }

    /**
     * Run an operation, signing in again and retrying once if the cloud says
     * the session is gone.
     *
     * @param {Function} operation
     * @returns {Promise<*>}
     * @private
     */
    async _withReauthentication(operation) {
        try {
            return await operation();
        } catch (error) {
            if (!(error instanceof CloudError) || error.reason !== ERROR.SESSION_EXPIRED) {
                throw error;
            }

            this._logger.log('[cloud]', 'session expired, signing in again');
            await this.authenticate(true);

            return operation();
        }
    }

    /**
     * Run an MQTT operation, reconnecting once if the connection has dropped.
     *
     * @param {Function} operation
     * @returns {Promise<*>}
     * @private
     */
    async _withReconnect(operation) {
        if (!this.connected) {
            await this.connect();
        }

        try {
            return await operation();
        } catch (error) {
            if (!(error instanceof CloudError) || error.reason !== ERROR.SESSION_EXPIRED) {
                throw error;
            }

            // The broker rejected our token: sign in again and rebuild the
            // connection before retrying.
            this._logger.log('[cloud]', 'broker rejected the session, reconnecting');
            this._closeMqtt();
            await this.authenticate(true);
            await this.connect();

            return operation();
        }
    }

    /**
     * @private
     */
    _closeMqtt() {
        if (!this._mqtt) {
            return;
        }

        const mqtt = this._mqtt;
        this._mqtt = null;

        try {
            mqtt.disconnect();
        } catch (error) {
            this._logger.error('[cloud]', 'could not close the broker connection:', error.message);
        }
    }

    /**
     * Close the MQTT connection and release its resources. Attached devices are
     * remembered so a later call to connect() restores them.
     */
    disconnect() {
        this._closeMqtt();
    }

    /**
     * Close the connection and forget every device. Used when the app shuts
     * down or the account is no longer in use.
     */
    stop() {
        this._attached.clear();
        this._closeMqtt();
    }

}

module.exports = {
    CloudConnection,
};
