'use strict';

const Homey = require('homey');
const session = require('./network/session');
const {
    PROPERTY, VALUE, POLLED_VENDOR_CODES, toVendor, fromColumns,
} = require('./network/properties');
const { buildCommandSequence, CommandQueue } = require('./network/commands');
const { CloudError, ERROR } = require('./network/errors');
const { compareBoolProperties } = require('../../utils');

// Interval between attempts to attach to the cloud (ms)
const CONNECT_RETRY_INTERVAL = 30 * 1000;

// Defaults for the user-configurable settings (see driver.compose.json). Each
// constant is the fallback for devices whose setting is not stored yet.

// Interval between polling status from the cloud (ms). Far longer than the
// local driver's: the cloud is slow and rate limits frequent callers.
const DEFAULT_POLLING_INTERVAL = 60 * 1000;

// Time to wait for the cloud to confirm a command (ms)
const DEFAULT_COMMAND_TIMEOUT = 10 * 1000;

// Timeout for opening the connection to the cloud (ms)
const DEFAULT_CONNECT_TIMEOUT = 30 * 1000;

// Time without any response from the cloud after which the connection is
// dropped and rebuilt (ms)
const DEFAULT_NO_RESPONSE_RECONNECT_TIMEOUT = 180 * 1000;

// Device setting ids (see driver.compose.json).
const SETTING = {
    ACCOUNT_EMAIL: 'account_email',
    MIN_TARGET_TEMPERATURE: 'min_target_temperature',
    POLLING_INTERVAL: 'polling_interval',
    COMMAND_TIMEOUT: 'command_timeout',
    CONNECT_TIMEOUT: 'connect_timeout',
    NO_RESPONSE_RECONNECT_TIMEOUT: 'no_response_reconnect_timeout',
};

// Settings read only when the connection is built, so they need a reconnect.
const CONNECTION_SETTINGS = [SETTING.COMMAND_TIMEOUT, SETTING.CONNECT_TIMEOUT];

// App setting holding one record per Gree account.
const ACCOUNTS_SETTING = 'cloud_accounts';

// Bounds for the target_temperature capability. The minimum is user
// configurable via "min_target_temperature" (some heat pumps support 8 °C).
const TARGET_TEMPERATURE_MAX = 30;
const TARGET_TEMPERATURE_STEP = 1;
const DEFAULT_MIN_TARGET_TEMPERATURE = 16;

class GreeCloudHVACDevice extends Homey.Device {

    /**
     * Shared connection for this device's Gree account.
     *
     * @type {object|null}
     * @private
     */
    _connection = null;

    /**
     * Connect-retry interval reference
     *
     * @type {NodeJS.Timeout|null}
     * @private
     */
    _connectIntervalRef = null;

    /**
     * Status-poll interval reference
     *
     * @type {NodeJS.Timeout|null}
     * @private
     */
    _pollIntervalRef = null;

    /**
     * Reconnect on prolonged lack of response timeout reference
     *
     * @type {NodeJS.Timeout|null}
     * @private
     */
    _noResponseReconnectTimeoutRef = null;

    /**
     * Latest known device properties, in friendly form.
     *
     * @type {Object<string, string|number>}
     * @private
     */
    _properties = {};

    /**
     * Setting values pending from onSettings, keyed by setting id. onSettings
     * runs before Homey persists the new values but can trigger a reconnect, so
     * reads go through _getSetting() and pick these up first.
     *
     * @type {object}
     * @private
     */
    _pendingSettings = {};

    async onInit() {
        this.log('Gree cloud device has been inited');

        this._flowTriggerHvacFanSpeedChanged = this.homey.flow.getDeviceTriggerCard('fan_speed_changed');
        this._flowTriggerTurboModeChanged = this.homey.flow.getDeviceTriggerCard('turbo_mode_changed');
        this._flowTriggerSafetyHeatingChanged = this.homey.flow.getDeviceTriggerCard('safety_heating_changed');
        this._flowTriggerHvacLightsChanged = this.homey.flow.getDeviceTriggerCard('lights_changed');
        this._flowTriggerXFanModeChanged = this.homey.flow.getDeviceTriggerCard('xfan_mode_changed');
        this._flowTriggerVerticalSwingChanged = this.homey.flow.getDeviceTriggerCard('vertical_swing_changed');
        this._flowTriggerHorizontalSwingChanged = this.homey.flow.getDeviceTriggerCard('horizontal_swing_changed');
        this._flowTriggerQuietModeChanged = this.homey.flow.getDeviceTriggerCard('quiet_mode_changed');
        this._flowTriggerHealthModeChanged = this.homey.flow.getDeviceTriggerCard('health_mode_changed');
        this._flowTriggerPowerSaveModeChanged = this.homey.flow.getDeviceTriggerCard('power_save_mode_changed');
        this._flowTriggerSleepModeChanged = this.homey.flow.getDeviceTriggerCard('sleep_mode_changed');
        this._flowTriggerFreshAirModeChanged = this.homey.flow.getDeviceTriggerCard('fresh_air_mode_changed');

        this._queue = new CommandQueue({
            onError: (error) => this.log('[queue]', 'command failed:', error.message),
        });

        await this._applyTargetTemperatureRange();
        this._registerCapabilityListeners();

        this._markOffline();
        this._startConnecting();
    }

    /**
     * Device was removed from Homey. Release the cloud connection.
     */
    onDeleted() {
        this.log('[on deleted]', 'Gree cloud device has been deleted. Detaching.');

        this._cleanup();

        this.log('[on deleted]', 'Cleanup after removing done');
    }

    /**
     * App is shutting down. The cloud connection owns a socket and timers the
     * SDK does not clean up for us, so the same cleanup as removal is needed.
     */
    async onUninit() {
        this.log('[on uninit]', 'App is shutting down. Detaching.');

        this._cleanup();

        this.log('[on uninit]', 'Cleanup done');
    }

    /**
     * Stop all timers and detach from the shared cloud connection.
     *
     * @private
     */
    _cleanup() {
        this._stopConnecting();
        this._stopPolling();
        this._cancelNoResponseReconnect();
        this._detach();
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        // Mirror pending values so a synchronous reconnect below picks up the
        // new settings before Homey has persisted them.
        changedKeys.forEach((key) => {
            this._pendingSettings[key] = newSettings[key];
        });

        if (changedKeys.includes(SETTING.MIN_TARGET_TEMPERATURE)) {
            this.log('[settings]', 'Minimum target temperature changed:', newSettings[SETTING.MIN_TARGET_TEMPERATURE]);
            await this._applyTargetTemperatureRange(newSettings[SETTING.MIN_TARGET_TEMPERATURE]);
        }

        if (changedKeys.includes(SETTING.POLLING_INTERVAL)) {
            this.log('[settings]', 'Polling interval changed. Rescheduling.');
            this._restartPolling();
        }

        // These are only read when the connection is built.
        if (changedKeys.some((key) => CONNECTION_SETTINGS.includes(key))) {
            this.log('[settings]', 'Connection setting changed. Reconnecting.');
            this.reconnect();
        }
    }

    /**
     * Apply the target_temperature capability range from the
     * "min_target_temperature" setting, so users can set lower temperatures
     * (e.g. 8 °C for frost protection). Max and step remain constant.
     *
     * @param {number} [min] Explicit minimum (e.g. from onSettings)
     * @private
     */
    async _applyTargetTemperatureRange(min) {
        const minTemperature = min
            ?? this.getSetting(SETTING.MIN_TARGET_TEMPERATURE)
            ?? DEFAULT_MIN_TARGET_TEMPERATURE;

        await this.setCapabilityOptions('target_temperature', {
            min: minTemperature,
            max: TARGET_TEMPERATURE_MAX,
            step: TARGET_TEMPERATURE_STEP,
        });
    }

    /**
     * Read a device setting, preferring a value pending from onSettings.
     *
     * @param {string} id Setting id
     * @param {*} [fallback] Value to use when the setting is null/undefined
     * @returns {*}
     * @private
     */
    _getSetting(id, fallback) {
        const value = id in this._pendingSettings
            ? this._pendingSettings[id]
            : this.getSetting(id);

        return value ?? fallback;
    }

    /**
     * Get the MAC address of the HVAC, which is also its cloud identifier.
     *
     * @returns {string|undefined}
     */
    getMac() {
        return this.getStoreValue('mac') || this.getData().mac;
    }

    /**
     * The stored Gree account record this device is controlled through.
     *
     * @returns {object|null}
     * @private
     */
    _getAccountRecord() {
        const accounts = this.homey.settings.get(ACCOUNTS_SETTING) || {};
        const key = this.getStoreValue('account_key');

        return (key && accounts[key]) || null;
    }

    /**
     * Try to attach to the cloud, retrying on a timer until it succeeds.
     *
     * @private
     */
    _startConnecting() {
        if (!this._connectIntervalRef) {
            this._connectIntervalRef = this.homey.setInterval(() => {
                this._attach().catch(() => {});
            }, CONNECT_RETRY_INTERVAL);
        }

        this._attach().catch(() => {});
    }

    /**
     * @private
     */
    _stopConnecting() {
        if (this._connectIntervalRef) {
            this.homey.clearInterval(this._connectIntervalRef);
            this._connectIntervalRef = null;
        }
    }

    /**
     * Attach this device to the connection shared by its Gree account.
     *
     * @returns {Promise<void>}
     * @private
     */
    async _attach() {
        if (this._connection) {
            return;
        }

        const record = this._getAccountRecord();
        if (!record) {
            this.log('[attach]', 'No stored Gree account. Repair this device to sign in.');
            this.setUnavailable(this.homey.__('error.cloud.session_expired')).catch(this.error);
            return;
        }

        const key = this.getStoreValue('key');
        if (!key) {
            this.log('[attach]', 'No encryption key stored for this device.');
            this.setUnavailable(this.homey.__('error.cloud.missing_key')).catch(this.error);
            return;
        }

        const connection = session.getConnection({
            region: record.region,
            username: record.email,
            password: record.password,
            account: record.account,
            logger: this,
            clientOptions: {
                requestTimeout: this._getSetting(SETTING.COMMAND_TIMEOUT, DEFAULT_COMMAND_TIMEOUT),
                connectTimeout: this._getSetting(SETTING.CONNECT_TIMEOUT, DEFAULT_CONNECT_TIMEOUT),
            },
            onAccountChange: (account) => this._persistAccount(account),
        });

        try {
            await connection.attachDevice({
                mac: this.getMac(),
                key,
                onProperties: (codes, values) => this._onUpdate(fromColumns(codes, values)),
            });
        } catch (error) {
            this._onError(error);
            throw error;
        }

        this._connection = connection;
        this._stopConnecting();

        this.log('[attach]', 'attached to the Gree cloud');
        this._cancelNoResponseReconnect();
        this.setAvailable().catch(this.error);

        this._restartPolling();
        await this._poll();
    }

    /**
     * Store a token the cloud handed out, so a restart does not need to sign in
     * again. Runs for every device on the account; they all write the same
     * value, which is harmless.
     *
     * @param {object} account
     * @private
     */
    _persistAccount(account) {
        const key = this.getStoreValue('account_key');
        const accounts = this.homey.settings.get(ACCOUNTS_SETTING) || {};

        if (!key || !accounts[key]) {
            return;
        }

        this.homey.settings.set(ACCOUNTS_SETTING, {
            ...accounts,
            [key]: { ...accounts[key], account },
        });
    }

    /**
     * Detach from the shared connection without disturbing other devices on the
     * same account.
     *
     * @private
     */
    _detach() {
        if (!this._connection) {
            return;
        }

        const connection = this._connection;
        this._connection = null;

        try {
            connection.detachDevice(this.getMac());
        } catch (error) {
            this.log('[detach]', 'could not detach cleanly:', error.message);
        }
    }

    /**
     * @private
     */
    _restartPolling() {
        this._stopPolling();

        const interval = this._getSetting(SETTING.POLLING_INTERVAL, DEFAULT_POLLING_INTERVAL);

        this._pollIntervalRef = this.homey.setInterval(() => {
            this._poll().catch(() => {});
        }, interval);
    }

    /**
     * @private
     */
    _stopPolling() {
        if (this._pollIntervalRef) {
            this.homey.clearInterval(this._pollIntervalRef);
            this._pollIntervalRef = null;
        }
    }

    /**
     * Read the current state from the cloud and push it into Homey.
     *
     * @returns {Promise<void>}
     * @private
     */
    async _poll() {
        if (!this._connection) {
            return;
        }

        try {
            const { cols, dat } = await this._connection.getStatus(this.getMac(), POLLED_VENDOR_CODES);
            this._onUpdate(fromColumns(cols, dat));
        } catch (error) {
            this._onNoResponse(error);
        }
    }

    /**
     * Register all applicable capabilities
     *
     * @private
     */
    _registerCapabilityListeners() {
        this.registerCapabilityListener('onoff', async (value) => {
            const rawValue = value ? VALUE.power.on : VALUE.power.off;
            this.log('[power mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.power]: rawValue });

            if (rawValue === VALUE.power.off) {
                // Set Thermostat mode to Off.
                this.setCapabilityValue('thermostat_mode', 'off').catch(this.error);
            } else {
                // Restore thermostat_mode.
                const mode = this._properties[PROPERTY.mode];

                if (mode !== undefined) {
                    this.setCapabilityValue('thermostat_mode', mode).catch(this.error);
                }
            }
        });

        this.registerCapabilityListener('target_temperature', async (value) => {
            this.log('[temperature change]', `Value: ${value}`);
            await this._setProperties({ [PROPERTY.temperature]: value });
        });

        this.registerCapabilityListener('thermostat_mode', async (value) => {
            if (value === 'off') {
                this.log('[power mode change]', `Value: ${value}`);
                await this._setProperties({ [PROPERTY.power]: VALUE.power.off });
                this.setCapabilityValue('onoff', false).catch(this.error);
                return;
            }

            const rawValue = VALUE.mode[value];
            if (rawValue === undefined) {
                throw new Error(`Unknown thermostat_mode value: ${JSON.stringify(value)}`);
            }

            this.log('[thermostat_mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);

            // Sent together so the mode is applied before the unit is powered
            // on, which the cloud requires to honour both.
            const properties = { [PROPERTY.mode]: rawValue };
            const wasOff = this._properties[PROPERTY.power] === VALUE.power.off;
            if (wasOff) {
                properties[PROPERTY.power] = VALUE.power.on;
            }

            await this._setProperties(properties);

            if (wasOff) {
                this.setCapabilityValue('onoff', true).catch(this.error);
            }
        });

        this.registerCapabilityListener('fan_speed', async (value) => {
            const rawValue = VALUE.fanSpeed[value];
            if (rawValue === undefined) {
                throw new Error(`Unknown fan speed value: ${JSON.stringify(value)}`);
            }
            this.log('[fan speed change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.fanSpeed]: rawValue });
            this._flowTriggerHvacFanSpeedChanged.trigger(this, { fan_speed: value });
        });

        this.registerCapabilityListener('turbo_mode', async (value) => {
            const rawValue = value ? VALUE.turbo.on : VALUE.turbo.off;
            this.log('[turbo mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.turbo]: rawValue });
            this._flowTriggerTurboModeChanged.trigger(this, { turbo_mode: value });
        });

        this.registerCapabilityListener('safety_heating', async (value) => {
            const rawValue = value ? VALUE.safetyHeating.on : VALUE.safetyHeating.off;
            this.log('[safety heating change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.safetyHeating]: rawValue });
            this._flowTriggerSafetyHeatingChanged.trigger(this, { safety_heating: value });
        });

        this.registerCapabilityListener('lights', async (value) => {
            const rawValue = value ? VALUE.lights.on : VALUE.lights.off;
            this.log('[lights change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.lights]: rawValue });
            this._flowTriggerHvacLightsChanged.trigger(this, { lights: value });
        });

        this.registerCapabilityListener('xfan_mode', async (value) => {
            const rawValue = value ? VALUE.blow.on : VALUE.blow.off;
            this.log('[xfan mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.blow]: rawValue });
            this._flowTriggerXFanModeChanged.trigger(this, { xfan_mode: value });
        });

        this.registerCapabilityListener('vertical_swing', async (value) => {
            const rawValue = VALUE.swingVert[value];
            if (rawValue === undefined) {
                throw new Error(`Unknown vertical swing value: ${JSON.stringify(value)}`);
            }
            this.log('[vertical swing change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.swingVert]: rawValue });
            this._flowTriggerVerticalSwingChanged.trigger(this, { vertical_swing: value });
        });

        this.registerCapabilityListener('horizontal_swing', async (value) => {
            const rawValue = VALUE.swingHor[value];
            if (rawValue === undefined) {
                throw new Error(`Unknown horizontal swing value: ${JSON.stringify(value)}`);
            }
            this.log('[horizontal swing change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.swingHor]: rawValue });
            this._flowTriggerHorizontalSwingChanged.trigger(this, { horizontal_swing: value });
        });

        this.registerCapabilityListener('quiet_mode', async (value) => {
            const rawValue = VALUE.quiet[value];
            if (rawValue === undefined) {
                throw new Error(`Unknown quiet mode value: ${JSON.stringify(value)}`);
            }
            this.log('[quiet mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.quiet]: rawValue });
            this._flowTriggerQuietModeChanged.trigger(this, { quiet_mode: value });
        });

        this.registerCapabilityListener('health_mode', async (value) => {
            const rawValue = value ? VALUE.health.on : VALUE.health.off;
            this.log('[health mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.health]: rawValue });
            this._flowTriggerHealthModeChanged.trigger(this, { health_mode: value });
        });

        this.registerCapabilityListener('power_save_mode', async (value) => {
            const rawValue = value ? VALUE.powerSave.on : VALUE.powerSave.off;
            this.log('[power save mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.powerSave]: rawValue });
            this._flowTriggerPowerSaveModeChanged.trigger(this, { power_save_mode: value });
        });

        this.registerCapabilityListener('sleep_mode', async (value) => {
            const rawValue = value ? VALUE.sleep.on : VALUE.sleep.off;
            this.log('[sleep mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.sleep]: rawValue });
            this._flowTriggerSleepModeChanged.trigger(this, { sleep_mode: value });
        });

        this.registerCapabilityListener('fresh_air_mode', async (value) => {
            const rawValue = VALUE.air[value];
            if (rawValue === undefined) {
                throw new Error(`Unknown fresh air mode value: ${JSON.stringify(value)}`);
            }
            this.log('[fresh air mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setProperties({ [PROPERTY.air]: rawValue });
            this._flowTriggerFreshAirModeChanged.trigger(this, { fresh_air_mode: value });
        });
    }

    /**
     * Write properties to the HVAC through the cloud.
     *
     * Rejects when the command could not be delivered, so the capability
     * listener propagates the rejection and Homey reverts the capability to its
     * previous value.
     *
     * @param {Object<string, string|number>} properties Friendly properties
     * @returns {Promise<void>} resolves once the cloud confirmed the command
     * @private
     */
    async _setProperties(properties) {
        if (!this._connection) {
            this.log('[set property]', 'Skip setting. Not connected to the cloud');
            throw new Error(this.homey.__('error.not_connected'));
        }

        // The cloud ignores all but the first of a batch of commands, and needs
        // some properties written together and in a particular order, so the
        // write is split into a sequence and run strictly one at a time.
        const commands = buildCommandSequence(toVendor(properties));

        try {
            await this._queue.add(async () => {
                for (const command of commands) {
                    // eslint-disable-next-line no-await-in-loop
                    await this._connection.setProperties(this.getMac(), command);
                }
            });
        } catch (error) {
            this.log('[set property]', 'Failed to write:', error.message);

            if (error instanceof CloudError && error.reason === ERROR.SESSION_EXPIRED) {
                this._markOffline(this.homey.__('error.cloud.session_expired'));
            }

            throw new Error(this.homey.__('error.not_connected'));
        }

        // Reflect what we just wrote, so a listener reading _properties before
        // the next poll sees the new state.
        Object.assign(this._properties, properties);
    }

    /**
     * Responsible for updating Homey device data based on information from the
     * cloud.
     *
     * @param {Object<string, string|number>} properties Friendly properties
     * @private
     */
    _onUpdate(properties) {
        if (Object.keys(properties).length === 0) {
            return;
        }

        // The cloud is answering again.
        this._cancelNoResponseReconnect();

        const previous = this._properties;
        this._properties = { ...previous, ...properties };

        // Only act on what actually changed, so triggers do not fire on every
        // poll. The full state is kept in this._properties.
        const updatedProperties = {};
        Object.entries(properties).forEach(([property, value]) => {
            if (previous[property] !== value) {
                updatedProperties[property] = value;
            }
        });

        const wasUnavailable = !this.getAvailable();
        if (wasUnavailable) {
            this.log('[update]', 'mark device available');
            this.setAvailable().catch(this.error);

            // Make sure thermostat_mode is right when the device comes back.
            if (this._properties[PROPERTY.power] === VALUE.power.off
                && this.getCapabilityValue('thermostat_mode') !== 'off') {
                updatedProperties[PROPERTY.mode] = 'off';
            }
        }

        if (this._checkBoolPropertyChanged(updatedProperties, PROPERTY.power, 'onoff')) {
            const isOn = updatedProperties[PROPERTY.power] === VALUE.power.on;
            this.setCapabilityValue('onoff', isOn).then(() => {
                this.log('[update properties]', '[onoff]', isOn);
                return Promise.resolve();
            }).catch(this.error);

            if (!isOn) {
                // Set Homey thermostat mode to Off when turned off.
                this.setCapabilityValue('thermostat_mode', 'off').then(() => {
                    this.log('[update properties]', '[thermostat_mode]', 'off');
                }).catch(this.error);
            } else {
                // Restore Homey thermostat mode when turned on.
                const thermostatValue = this._properties[PROPERTY.mode];

                this.setCapabilityValue('thermostat_mode', thermostatValue).then(() => {
                    this.log('[update properties]', '[thermostat_mode]', thermostatValue);
                }).catch(this.error);
            }

            // Prevent duplicate thermostat_mode update.
            if (updatedProperties[PROPERTY.mode] !== undefined) {
                delete updatedProperties[PROPERTY.mode];
            }
        }

        if (this._checkPropertyChanged(updatedProperties, PROPERTY.temperature, 'target_temperature')) {
            const value = updatedProperties[PROPERTY.temperature];
            this.setCapabilityValue('target_temperature', value).then(() => {
                this.log('[update properties]', '[target_temperature]', value);
                return Promise.resolve();
            }).catch(this.error);
        }

        if (this._checkCurrentTemperaturePropertyChanged(updatedProperties, PROPERTY.currentTemperature, 'measure_temperature')) {
            let value = updatedProperties[PROPERTY.currentTemperature];
            if (value === 0) {
                value = null;
            }
            this.setCapabilityValue('measure_temperature', value).then(() => {
                this.log('[update properties]', '[measure_temperature]', value);
                return Promise.resolve();
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, PROPERTY.mode, 'thermostat_mode')) {
            if (this._properties[PROPERTY.power] === VALUE.power.off) {
                // When the HVAC is off, thermostat_mode is always "off".
                if (this.getCapabilityValue('thermostat_mode') !== 'off') {
                    this.setCapabilityValue('thermostat_mode', 'off').then(() => {
                        this.log('[update properties]', '[thermostat_mode]', 'off');
                    }).catch(this.error);
                }
            } else {
                const thermostatValue = updatedProperties[PROPERTY.mode];

                this.setCapabilityValue('thermostat_mode', thermostatValue).then(() => {
                    this.log('[update properties]', '[thermostat_mode]', thermostatValue);
                }).catch(this.error);
            }
        }

        if (this._checkPropertyChanged(updatedProperties, PROPERTY.fanSpeed, 'fan_speed')) {
            const value = updatedProperties[PROPERTY.fanSpeed];
            this.setCapabilityValue('fan_speed', value).then(() => {
                this.log('[update properties]', '[fan_speed]', value);
                return this._flowTriggerHvacFanSpeedChanged.trigger(this, { fan_speed: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, PROPERTY.turbo, 'turbo_mode')) {
            const value = updatedProperties[PROPERTY.turbo] === VALUE.turbo.on;
            this.setCapabilityValue('turbo_mode', value).then(() => {
                this.log('[update properties]', '[turbo_mode]', value);
                return this._flowTriggerTurboModeChanged.trigger(this, { turbo_mode: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, PROPERTY.safetyHeating, 'safety_heating')) {
            const value = updatedProperties[PROPERTY.safetyHeating] === VALUE.safetyHeating.on;
            this.setCapabilityValue('safety_heating', value).then(() => {
                this.log('[update properties]', '[safety_heating]', value);
                return this._flowTriggerSafetyHeatingChanged.trigger(this, { safety_heating: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, PROPERTY.lights, 'lights')) {
            const value = updatedProperties[PROPERTY.lights] === VALUE.lights.on;
            this.setCapabilityValue('lights', value).then(() => {
                this.log('[update properties]', '[lights]', value);
                return this._flowTriggerHvacLightsChanged.trigger(this, { lights: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, PROPERTY.blow, 'xfan_mode')) {
            const value = updatedProperties[PROPERTY.blow] === VALUE.blow.on;
            this.setCapabilityValue('xfan_mode', value).then(() => {
                this.log('[update properties]', '[xfan_mode]', value);
                return this._flowTriggerXFanModeChanged.trigger(this, { xfan_mode: value });
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, PROPERTY.swingVert, 'vertical_swing')) {
            const value = updatedProperties[PROPERTY.swingVert];
            this.setCapabilityValue('vertical_swing', value).then(() => {
                this.log('[update properties]', '[vertical_swing]', value);
                return this._flowTriggerVerticalSwingChanged.trigger(this, { vertical_swing: value });
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, PROPERTY.swingHor, 'horizontal_swing')) {
            const value = updatedProperties[PROPERTY.swingHor];
            this.setCapabilityValue('horizontal_swing', value).then(() => {
                this.log('[update properties]', '[horizontal_swing]', value);
                return this._flowTriggerHorizontalSwingChanged.trigger(this, { horizontal_swing: value });
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, PROPERTY.quiet, 'quiet_mode')) {
            const value = updatedProperties[PROPERTY.quiet];
            this.setCapabilityValue('quiet_mode', value).then(() => {
                this.log('[update properties]', '[quiet_mode]', value);
                return this._flowTriggerQuietModeChanged.trigger(this, { quiet_mode: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, PROPERTY.health, 'health_mode')) {
            const value = updatedProperties[PROPERTY.health] === VALUE.health.on;
            this.setCapabilityValue('health_mode', value).then(() => {
                this.log('[update properties]', '[health_mode]', value);
                return this._flowTriggerHealthModeChanged.trigger(this, { health_mode: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, PROPERTY.powerSave, 'power_save_mode')) {
            const value = updatedProperties[PROPERTY.powerSave] === VALUE.powerSave.on;
            this.setCapabilityValue('power_save_mode', value).then(() => {
                this.log('[update properties]', '[power_save_mode]', value);
                return this._flowTriggerPowerSaveModeChanged.trigger(this, { power_save_mode: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, PROPERTY.sleep, 'sleep_mode')) {
            const value = updatedProperties[PROPERTY.sleep] === VALUE.sleep.on;
            this.setCapabilityValue('sleep_mode', value).then(() => {
                this.log('[update properties]', '[sleep_mode]', value);
                return this._flowTriggerSleepModeChanged.trigger(this, { sleep_mode: value });
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, PROPERTY.air, 'fresh_air_mode')) {
            const value = updatedProperties[PROPERTY.air];
            this.setCapabilityValue('fresh_air_mode', value).then(() => {
                this.log('[update properties]', '[fresh_air_mode]', value);
                return this._flowTriggerFreshAirModeChanged.trigger(this, { fresh_air_mode: value });
            }).catch(this.error);
        }
    }

    /**
     * @param {Error} error
     * @private
     */
    _onError(error) {
        this.log('[ERROR]', 'Message:', error.message);

        if (error instanceof CloudError && error.reason === ERROR.INVALID_CREDENTIALS) {
            this._markOffline(this.homey.__('error.cloud.invalid_credentials'));
            return;
        }

        if (error instanceof CloudError && error.reason === ERROR.SESSION_EXPIRED) {
            this._markOffline(this.homey.__('error.cloud.session_expired'));
            return;
        }

        this._markOffline();
    }

    /**
     * The cloud did not answer a poll. Mark the device offline and, if it stays
     * silent, drop the connection and build it again.
     *
     * @param {Error} error
     * @private
     */
    _onNoResponse(error) {
        this.log('[no response]', 'Polling failed:', error.message);
        this._onError(error);
        this._scheduleNoResponseReconnect();
    }

    /**
     * @private
     */
    _scheduleNoResponseReconnect() {
        if (this._noResponseReconnectTimeoutRef) {
            return;
        }

        const timeout = this._getSetting(
            SETTING.NO_RESPONSE_RECONNECT_TIMEOUT,
            DEFAULT_NO_RESPONSE_RECONNECT_TIMEOUT,
        );

        this._noResponseReconnectTimeoutRef = this.homey.setTimeout(() => {
            this._noResponseReconnectTimeoutRef = null;
            this.log('[no response]', 'No response for too long. Reconnecting');
            this.reconnect();
        }, timeout);
    }

    /**
     * @private
     */
    _cancelNoResponseReconnect() {
        if (this._noResponseReconnectTimeoutRef) {
            this.homey.clearTimeout(this._noResponseReconnectTimeoutRef);
            this._noResponseReconnectTimeoutRef = null;
        }
    }

    /**
     * Mark the device as offline in Homey
     *
     * @param {string} [message] Reason to show the user
     * @private
     */
    _markOffline(message) {
        this.log('[offline] mark device offline');
        this.setUnavailable(message || this.homey.__('error.offline')).catch(this.error);
    }

    /**
     * Check that properties from the HVAC and from the Homey capability changed
     *
     * @param {object} updatedProperties
     * @param {string} propertyName
     * @param {string} capabilityName
     * @returns {boolean}
     * @private
     */
    _checkPropertyChanged(updatedProperties, propertyName, capabilityName) {
        if (!Object.prototype.hasOwnProperty.call(updatedProperties, propertyName)) {
            return false;
        }

        return updatedProperties[propertyName] !== this.getCapabilityValue(capabilityName);
    }

    /**
     * Same as _checkPropertyChanged plus treating a null capability with a "0"
     * reading as "no data available", which is not a change.
     *
     * @param {object} updatedProperties
     * @param {string} propertyName
     * @param {string} capabilityName
     * @returns {boolean}
     * @private
     */
    _checkCurrentTemperaturePropertyChanged(updatedProperties, propertyName, capabilityName) {
        if (!Object.prototype.hasOwnProperty.call(updatedProperties, propertyName)) {
            return false;
        }

        const hvacValue = updatedProperties[propertyName];
        const capabilityValue = this.getCapabilityValue(capabilityName);

        if (capabilityValue === null && hvacValue === 0) {
            return false;
        }

        return hvacValue !== capabilityValue;
    }

    /**
     * Special checks for boolean logic
     *
     * @param {object} updatedProperties
     * @param {string} propertyName
     * @param {string} capabilityName
     * @returns {boolean}
     * @private
     */
    _checkBoolPropertyChanged(updatedProperties, propertyName, capabilityName) {
        if (!Object.prototype.hasOwnProperty.call(updatedProperties, propertyName)) {
            return false;
        }

        return compareBoolProperties(
            updatedProperties[propertyName],
            this.getCapabilityValue(capabilityName),
            VALUE[propertyName].on,
        );
    }

    /**
     * Drop the cloud connection and build it again. Used after a settings change
     * and when the cloud has gone quiet for too long.
     */
    reconnect() {
        this.log('Reconnecting to the Gree cloud');
        this._cancelNoResponseReconnect();
        this._stopPolling();
        this._markOffline();
        this._detach();
        this._startConnecting();
    }

}

module.exports = GreeCloudHVACDevice;
