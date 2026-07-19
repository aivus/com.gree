'use strict';

const Homey = require('homey');
const HVAC = require('gree-hvac-client');
const finder = require('./network/finder');
const { compareBoolProperties, isValidIpv4 } = require('../../utils');

// Interval between trying to found HVAC in network (ms)
const LOOKING_FOR_DEVICE_TIME_INTERVAL = 5000;

// Defaults for the user-configurable connection timeouts (ms). Each has a
// matching device setting (see driver.compose.json "Connection" group); the
// constant is used as a fallback for devices whose setting is not stored yet.

// Interval between polling status from HVAC (ms)
const DEFAULT_POLLING_INTERVAL = 3500;

// Timeout for response from the HVAC during polling process (ms)
const DEFAULT_POLLING_TIMEOUT = 3000;

// Timeout of the connection to the HVAC (ms)
const DEFAULT_CONNECT_TIMEOUT = 5000;

// Time without any response from the HVAC after which
// the connection is dropped and discovery is restarted (ms)
const DEFAULT_NO_RESPONSE_RECONNECT_TIMEOUT = 60 * 1000;

// Device setting ids (see driver.compose.json).
const SETTING = {
    STATIC_IP: 'static_ip',
    MIN_TARGET_TEMPERATURE: 'min_target_temperature',
    POLLING_INTERVAL: 'polling_interval',
    POLLING_TIMEOUT: 'polling_timeout',
    CONNECT_TIMEOUT: 'connect_timeout',
    NO_RESPONSE_RECONNECT_TIMEOUT: 'no_response_reconnect_timeout',
};

// Settings that are only read when the HVAC client is constructed and therefore
// require a reconnect to take effect.
const CLIENT_TIMEOUT_SETTINGS = [SETTING.POLLING_INTERVAL, SETTING.POLLING_TIMEOUT, SETTING.CONNECT_TIMEOUT];

// All user-configurable timeout settings (ms).
const TIMEOUT_SETTINGS = [...CLIENT_TIMEOUT_SETTINGS, SETTING.NO_RESPONSE_RECONNECT_TIMEOUT];

// Bounds for the target_temperature capability. The minimum is user-configurable
// via the "min_target_temperature" device setting (some heat pumps support 8 °C).
const TARGET_TEMPERATURE_MAX = 30;
const TARGET_TEMPERATURE_STEP = 1;
const DEFAULT_MIN_TARGET_TEMPERATURE = 16;

class GreeHVACDevice extends Homey.Device {

    /**
     * Instance of Client to interact with HVAC
     *
     * @type {Client|null}
     * @private
     */
    _client = null;

    /**
     * Looking for a device interval reference
     *
     * @type {NodeJS.Timeout}
     * @private
     */
    _lookingForDeviceIntervalRef = null;

    /**
     * Reconnect on prolonged lack of response timeout reference
     *
     * @type {NodeJS.Timeout|null}
     * @private
     */
    _noResponseReconnectTimeoutRef = null;

    /**
     * Setting values pending from onSettings, keyed by setting id.
     *
     * onSettings runs before Homey persists the new settings but can trigger a
     * synchronous reconnect; the new values are mirrored here so reads via
     * _getSetting() pick them up instead of the stale getSetting() value.
     * onSettings is the only place settings change, so this never diverges from
     * the persisted state.
     *
     * @type {Object}
     * @private
     */
    _pendingSettings = {};

    async onInit() {
        this.log('Gree device has been inited');

        this._flowTriggerHvacFanSpeedChanged = this.homey.flow.getDeviceTriggerCard('fan_speed_changed');
        this._flowTriggerHvacModeChanged = this.homey.flow.getDeviceTriggerCard('hvac_mode_changed');
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

        await this._executeCapabilityMigrations();
        await this._executeDeviceClassMigration();
        await this._applyTargetTemperatureRange();
        this._registerCapabilityListeners();

        this._markOffline();
        this._startLookingForDevice();
    }

    /**
     * Fire the deprecated `hvac_mode_changed` trigger and, when the card is
     * actually used in a Flow, warn the user that it is deprecated.
     *
     * The card has no arguments, so Homey never invokes a run listener for it.
     * Usage is instead detected with getArgumentValues(), which resolves to one
     * entry per Flow that references the card for this device.
     *
     * @param {string} hvacMode
     * @returns {Promise<void>}
     * @private
     */
    async _triggerHvacModeChanged(hvacMode) {
        await this._flowTriggerHvacModeChanged.trigger(this, { hvac_mode: hvacMode });

        try {
            const usages = await this._flowTriggerHvacModeChanged.getArgumentValues(this);
            if (usages.length > 0) {
                await this.homey.app._notifyDeprecatedFlowCard('hvac_mode_changed');
            }
        } catch (err) {
            this.error('Failed to check deprecated hvac_mode_changed flow card usage', err);
        }
    }

    /**
     * Device was removed from Homey. Cleanup, remove all listeners, disconnect from the HVAC
     */
    onDeleted() {
        this.log('[on deleted]', 'Gree device has been deleted. Disconnecting _client.');

        this._cleanup();

        this.log('[on deleted]', 'Cleanup after removing done');
    }

    /**
     * App is shutting down. Same cleanup as removal: the HVAC client owns
     * its own socket and timers which the SDK does not clean up for us.
     */
    async onUninit() {
        this.log('[on uninit]', 'App is shutting down. Disconnecting _client.');

        this._cleanup();

        this.log('[on uninit]', 'Cleanup done');
    }

    /**
     * Stop all timers and disconnect from the HVAC
     *
     * @private
     */
    _cleanup() {
        this._stopLookingForDevice();
        this._cancelNoResponseReconnect();
        this._tryToDisconnect();
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        // Validate before applying anything: the client sends a status request
        // every polling_interval and gives up after polling_timeout, so the
        // timeout must stay below the interval or requests overlap and the
        // no-response detection becomes unreliable.
        if (changedKeys.includes(SETTING.POLLING_INTERVAL) || changedKeys.includes(SETTING.POLLING_TIMEOUT)) {
            const interval = newSettings[SETTING.POLLING_INTERVAL] ?? DEFAULT_POLLING_INTERVAL;
            const timeout = newSettings[SETTING.POLLING_TIMEOUT] ?? DEFAULT_POLLING_TIMEOUT;

            if (timeout >= interval) {
                throw new Error(this.homey.__('error.polling_timeout_too_high'));
            }
        }

        if (changedKeys.includes(SETTING.STATIC_IP) && oldSettings[SETTING.STATIC_IP] !== newSettings[SETTING.STATIC_IP]) {
            if (newSettings[SETTING.STATIC_IP] && !isValidIpv4(newSettings[SETTING.STATIC_IP])) {
                throw new Error(this.homey.__('error.invalid_static_ip'));
            }

            this.log('[settings]', 'Static IP changed. Reconnecting.');
            this._pendingSettings[SETTING.STATIC_IP] = newSettings[SETTING.STATIC_IP];
            this.reconnect();
        }

        if (changedKeys.includes(SETTING.MIN_TARGET_TEMPERATURE)) {
            this.log('[settings]', 'Minimum target temperature changed:', newSettings[SETTING.MIN_TARGET_TEMPERATURE]);
            await this._applyTargetTemperatureRange(newSettings[SETTING.MIN_TARGET_TEMPERATURE]);
        }

        // Mirror pending timeout values so the synchronous reconnect below (and
        // the next no-response schedule) picks up the new values before Homey
        // has persisted them.
        const changedTimeouts = TIMEOUT_SETTINGS.filter((key) => changedKeys.includes(key));
        changedTimeouts.forEach((key) => {
            this._pendingSettings[key] = newSettings[key];
        });

        // The client-facing timeouts are only read when the HVAC client is
        // constructed, so a reconnect is needed to rebuild it with the new
        // values. The "no_response_reconnect_timeout" is read live on each
        // schedule and needs no reconnect.
        if (this._client && changedTimeouts.some((key) => CLIENT_TIMEOUT_SETTINGS.includes(key))) {
            this.log('[settings]', 'Connection timeout changed. Reconnecting.');
            this.reconnect();
        }
    }

    /**
     * Apply the target_temperature capability range. The minimum is taken from the
     * "min_target_temperature" device setting so users can set lower temperatures
     * (e.g. 8 °C for frost protection). Max and step remain constant.
     *
     * @param {number} [min] Explicit minimum (e.g. from onSettings' newSettings);
     *                       falls back to the persisted setting when omitted.
     * @private
     */
    async _applyTargetTemperatureRange(min) {
        const minTemperature = min ?? this.getSetting(SETTING.MIN_TARGET_TEMPERATURE) ?? DEFAULT_MIN_TARGET_TEMPERATURE;

        await this.setCapabilityOptions('target_temperature', {
            min: minTemperature,
            max: TARGET_TEMPERATURE_MAX,
            step: TARGET_TEMPERATURE_STEP,
        });
    }

    /**
     * Check all available HVACs from the Finder module
     * and try to find one which will work with this Device instance
     * based on MAC address. If a static IP is configured, connect directly.
     *
     * @private
     */
    _findDevices() {
        if (this._client) {
            return;
        }

        const staticIp = this._getStaticIpSetting();

        if (staticIp) {
            this.log('[find devices]', 'Using static IP:', staticIp);
            this._stopLookingForDevice();
            this._connectToHost(staticIp);
            return;
        }

        const mac = this.getMac();

        if (!mac) {
            // Paired via "Skip UDP scan" and never connected so far:
            // the real MAC is unknown until the first successful
            // connection via static IP, so discovery cannot match anything
            this.log('[find devices]', 'MAC is not known yet. Set a static IP to connect');
            return;
        }

        this.log('[find devices]', 'Finding device with mac:', mac);

        finder.hvacs.forEach((hvac) => {
            if (hvac.message.mac !== mac) {
                // Skip other HVACs from the finder until find current
                this.log('[find devices]', 'Skipping HVAC with mac:', hvac.message.mac);
                return;
            }

            this.log('[find devices]', 'Connecting to device with mac:', hvac.message.mac);

            this._stopLookingForDevice();
            this._connectToHost(hvac.remoteInfo.address);
        });
    }

    /**
     * Create a client for the given host and register listeners.
     *
     * @param {string} host
     * @private
     */
    _connectToHost(host) {
        this._client = new HVAC.Client({
            logLevel: 'debug',
            host,
            pollingInterval: this._getSetting(SETTING.POLLING_INTERVAL, DEFAULT_POLLING_INTERVAL),
            pollingTimeout: this._getSetting(SETTING.POLLING_TIMEOUT, DEFAULT_POLLING_TIMEOUT),
            connectTimeout: this._getSetting(SETTING.CONNECT_TIMEOUT, DEFAULT_CONNECT_TIMEOUT),
        });

        this._registerClientListeners();
    }

    /**
     * Read a device setting, preferring a value pending from onSettings over the
     * persisted one (see _pendingSettings). Falls back to the given default when
     * the resolved value is null/undefined, e.g. for devices paired before the
     * setting existed.
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
     * Register all applicable event listeners to the HVAC Client instance
     *
     * @private
     */
    _registerClientListeners() {
        this._client.on('error', this._onError.bind(this));
        this._client.on('disconnect', this._onDisconnect.bind(this));
        this._client.on('connect', this._onConnect.bind(this));
        this._client.on('update', this._onUpdate.bind(this));
        this._client.on('no_response', this._onNoResponse.bind(this));
    }

    /**
     * Register all applicable capabilities
     *
     * @private
     */
    _registerCapabilityListeners() {
        this.registerCapabilityListener('onoff', async (value) => {
            const rawValue = value ? HVAC.VALUE.power.on : HVAC.VALUE.power.off;
            this.log('[power mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.power, rawValue);

            if (rawValue === HVAC.VALUE.power.off) {
                // Set Thermostat mode to Off.
                this.setCapabilityValue('thermostat_mode', 'off').catch(this.error);
            } else {
                // Restore thermostat_mode.
                const properties = this._getCurrentClientProperties();
                const mode = properties[HVAC.PROPERTY.mode];

                if (mode !== undefined) {
                    this.setCapabilityValue('thermostat_mode', HVAC.VALUE.mode[mode]).catch(this.error);
                }
            }
        });

        this.registerCapabilityListener('target_temperature', async (value) => {
            this.log('[temperature change]', `Value: ${value}`);
            await this._setClientProperty(HVAC.PROPERTY.temperature, value);
        });

        this.registerCapabilityListener('thermostat_mode', async (value) => {
            if (value === 'off') {
                this.log('[power mode change]', `Value: ${value}`);
                await this._setClientProperty(HVAC.PROPERTY.power, HVAC.VALUE.power.off);
                this.setCapabilityValue('onoff', false).catch(this.error);
            } else {
                const rawValue = HVAC.VALUE.mode[value];
                if (rawValue === undefined) {
                    throw new Error(`Unknown thermostat_mode value: ${JSON.stringify(value)}`);
                }
                this.log('[thermostat_mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
                await this._setClientProperty(HVAC.PROPERTY.mode, rawValue);

                // Turn on if needed.
                const properties = this._getCurrentClientProperties();
                if (properties[HVAC.PROPERTY.power] === HVAC.VALUE.power.off) {
                    await this._setClientProperty(HVAC.PROPERTY.power, HVAC.VALUE.power.on);
                    this.setCapabilityValue('onoff', true).catch(this.error);
                }
            }
        });

        this.registerCapabilityListener('fan_speed', async (value) => {
            const rawValue = HVAC.VALUE.fanSpeed[value];
            if (rawValue === undefined) {
                throw new Error(`Unknown fan speed value: ${JSON.stringify(value)}`);
            }
            this.log('[fan speed change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.fanSpeed, rawValue);
            this._flowTriggerHvacFanSpeedChanged.trigger(this, { fan_speed: value });
        });

        this.registerCapabilityListener('turbo_mode', async (value) => {
            const rawValue = value ? HVAC.VALUE.turbo.on : HVAC.VALUE.turbo.off;
            this.log('[turbo mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.turbo, rawValue);
            this._flowTriggerTurboModeChanged.trigger(this, { turbo_mode: value });
        });

        this.registerCapabilityListener('safety_heating', async (value) => {
            const rawValue = value ? HVAC.VALUE.safetyHeating.on : HVAC.VALUE.safetyHeating.off;
            this.log('[safety heating change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.safetyHeating, rawValue);
            this._flowTriggerSafetyHeatingChanged.trigger(this, { safety_heating: value });
        });

        this.registerCapabilityListener('lights', async (value) => {
            const rawValue = value ? HVAC.VALUE.lights.on : HVAC.VALUE.lights.off;
            this.log('[lights change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.lights, rawValue);
            this._flowTriggerHvacLightsChanged.trigger(this, { lights: value });
        });

        this.registerCapabilityListener('xfan_mode', async (value) => {
            const rawValue = value ? HVAC.VALUE.blow.on : HVAC.VALUE.blow.off;
            this.log('[xfan mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.blow, rawValue);
            this._flowTriggerXFanModeChanged.trigger(this, { xfan_mode: value });
        });

        this.registerCapabilityListener('vertical_swing', async (value) => {
            const rawValue = HVAC.VALUE.swingVert[value];
            if (rawValue === undefined) {
                throw new Error(`Unknown vertical swing value: ${JSON.stringify(value)}`);
            }
            this.log('[vertical swing change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.swingVert, rawValue);
            this._flowTriggerVerticalSwingChanged.trigger(this, { vertical_swing: value });
        });

        this.registerCapabilityListener('horizontal_swing', async (value) => {
            const rawValue = HVAC.VALUE.swingHor[value];
            if (rawValue === undefined) {
                throw new Error(`Unknown horizontal swing value: ${JSON.stringify(value)}`);
            }
            this.log('[horizontal swing change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.swingHor, rawValue);
            this._flowTriggerHorizontalSwingChanged.trigger(this, { horizontal_swing: value });
        });

        this.registerCapabilityListener('quiet_mode', async (value) => {
            const rawValue = HVAC.VALUE.quiet[value];
            if (rawValue === undefined) {
                throw new Error(`Unknown quiet mode value: ${JSON.stringify(value)}`);
            }
            this.log('[quiet mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.quiet, rawValue);
            this._flowTriggerQuietModeChanged.trigger(this, { quiet_mode: value });
        });

        this.registerCapabilityListener('health_mode', async (value) => {
            const rawValue = value ? HVAC.VALUE.health.on : HVAC.VALUE.health.off;
            this.log('[health mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.health, rawValue);
            this._flowTriggerHealthModeChanged.trigger(this, { health_mode: value });
        });

        this.registerCapabilityListener('power_save_mode', async (value) => {
            const rawValue = value ? HVAC.VALUE.powerSave.on : HVAC.VALUE.powerSave.off;
            this.log('[power save mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.powerSave, rawValue);
            this._flowTriggerPowerSaveModeChanged.trigger(this, { power_save_mode: value });
        });

        this.registerCapabilityListener('sleep_mode', async (value) => {
            const rawValue = value ? HVAC.VALUE.sleep.on : HVAC.VALUE.sleep.off;
            this.log('[sleep mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.sleep, rawValue);
            this._flowTriggerSleepModeChanged.trigger(this, { sleep_mode: value });
        });

        this.registerCapabilityListener('fresh_air_mode', async (value) => {
            const rawValue = HVAC.VALUE.air[value];
            if (rawValue === undefined) {
                throw new Error(`Unknown fresh air mode value: ${JSON.stringify(value)}`);
            }
            this.log('[fresh air mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            await this._setClientProperty(HVAC.PROPERTY.air, rawValue);
            this._flowTriggerFreshAirModeChanged.trigger(this, { fresh_air_mode: value });
        });
    }

    /**
     * App is successfully connected to the HVAC
     * Mark device as available in Homey
     *
     * @param {HVAC.Client} client
     * @private
     */
    _onConnect(client) {
        this.log('[connect]', 'connected to', client.getDeviceId());
        this.log('[connect]', 'mark device available');
        this._cancelNoResponseReconnect();
        this._updateMacFromClient(client);
        this.setAvailable();
    }

    /**
     * Responsible for updating Homey device data based on information from HVAC
     *
     * @param {Array} updatedProperties Only changed properties
     * @param {Array} properties All properties
     * @private
     */
    _onUpdate(updatedProperties, properties) {
        // { power: 'on',
        //     mode: 'cool',
        //     temperatureUnit: 'celsius',
        //     temperature: 25,
        //     fanSpeed: 'low',
        //     air: 'off',
        //     blow: 'off',
        //     health: 'on',
        //     sleep: 'off',
        //     lights: 'on',
        //     swingHor: 'default',
        //     swingVert: 'fixedBottom',
        //     quiet: 'off',
        //     turbo: 'off',
        //     powerSave: 'off' }

        // The HVAC is responding again
        this._cancelNoResponseReconnect();

        if (!this.getAvailable()) {
            this.log('[update]', 'mark device available');
            this.setAvailable();

            // Ensure that thermostat_mode is properly set in Homey when device becomes available.
            if (properties[HVAC.PROPERTY.power] === HVAC.VALUE.power.off && this.getCapabilityValue('thermostat_mode') !== 'off') {
                updatedProperties[HVAC.PROPERTY.mode] = 'off';
            }
        }

        if (this._checkBoolPropertyChanged(updatedProperties, HVAC.PROPERTY.power, 'onoff')) {
            const isOn = updatedProperties[HVAC.PROPERTY.power] === HVAC.VALUE.power.on;
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
                const thermostatValue = properties[HVAC.PROPERTY.mode];

                this.setCapabilityValue('thermostat_mode', thermostatValue).then(() => {
                    this.log('[update properties]', '[thermostat_mode]', thermostatValue);
                    return this._triggerHvacModeChanged(thermostatValue);
                }).catch(this.error);
            }

            // Prevent duplicate thermostat_mode update.
            if (updatedProperties[HVAC.PROPERTY.mode] !== undefined) {
                delete updatedProperties[HVAC.PROPERTY.mode];
            }
        }

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.temperature, 'target_temperature')) {
            const value = updatedProperties[HVAC.PROPERTY.temperature];
            this.setCapabilityValue('target_temperature', value).then(() => {
                this.log('[update properties]', '[target_temperature]', value);
                return Promise.resolve();
            }).catch(this.error);
        }

        if (this._checkCurrentTemperaturePropertyChanged(updatedProperties, HVAC.PROPERTY.currentTemperature, 'measure_temperature')) {
            let value = updatedProperties[HVAC.PROPERTY.currentTemperature];
            if (value === 0) {
                value = null;
            }
            this.setCapabilityValue('measure_temperature', value).then(() => {
                this.log('[update properties]', '[measure_temperature]', value);
                return Promise.resolve();
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.mode, 'thermostat_mode')) {
            // Update thermostat_mode
            if (properties[HVAC.PROPERTY.power] === HVAC.VALUE.power.off) {
                // When HVAC is off, thermostat_mode should be always "off".
                if (this.getCapabilityValue('thermostat_mode') !== 'off') {
                    this.setCapabilityValue('thermostat_mode', 'off').then(() => {
                        this.log('[update properties]', '[thermostat_mode]', 'off');
                    }).catch(this.error);
                }
            } else {
                const thermostatValue = updatedProperties[HVAC.PROPERTY.mode];

                this.setCapabilityValue('thermostat_mode', thermostatValue).then(() => {
                    this.log('[update properties]', '[thermostat_mode]', thermostatValue);
                    return this._triggerHvacModeChanged(thermostatValue);
                }).catch(this.error);
            }
        }

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.fanSpeed, 'fan_speed')) {
            const value = updatedProperties[HVAC.PROPERTY.fanSpeed];
            this.setCapabilityValue('fan_speed', value).then(() => {
                this.log('[update properties]', '[fan_speed]', value);
                return this._flowTriggerHvacFanSpeedChanged.trigger(this, { fan_speed: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, HVAC.PROPERTY.turbo, 'turbo_mode')) {
            const value = updatedProperties[HVAC.PROPERTY.turbo] === HVAC.VALUE.turbo.on;
            this.setCapabilityValue('turbo_mode', value).then(() => {
                this.log('[update properties]', '[turbo_mode]', value);
                return this._flowTriggerTurboModeChanged.trigger(this, { turbo_mode: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, HVAC.PROPERTY.safetyHeating, 'safety_heating')) {
            const value = updatedProperties[HVAC.PROPERTY.safetyHeating] === HVAC.VALUE.safetyHeating.on;
            this.setCapabilityValue('safety_heating', value).then(() => {
                this.log('[update properties]', '[safety_heating]', value);
                return this._flowTriggerSafetyHeatingChanged.trigger(this, { safety_heating: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, HVAC.PROPERTY.lights, 'lights')) {
            const value = updatedProperties[HVAC.PROPERTY.lights] === HVAC.VALUE.lights.on;
            this.setCapabilityValue('lights', value).then(() => {
                this.log('[update properties]', '[lights]', value);
                return this._flowTriggerHvacLightsChanged.trigger(this, { lights: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, HVAC.PROPERTY.blow, 'xfan_mode')) {
            const value = updatedProperties[HVAC.PROPERTY.blow] === HVAC.VALUE.blow.on;
            this.setCapabilityValue('xfan_mode', value).then(() => {
                this.log('[update properties]', '[xfan_mode]', value);
                return this._flowTriggerXFanModeChanged.trigger(this, { xfan_mode: value });
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.swingVert, 'vertical_swing')) {
            const value = updatedProperties[HVAC.PROPERTY.swingVert];
            this.setCapabilityValue('vertical_swing', value).then(() => {
                this.log('[update properties]', '[vertical_swing]', value);
                return this._flowTriggerVerticalSwingChanged.trigger(this, { vertical_swing: value });
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.swingHor, 'horizontal_swing')) {
            const value = updatedProperties[HVAC.PROPERTY.swingHor];
            this.setCapabilityValue('horizontal_swing', value).then(() => {
                this.log('[update properties]', '[horizontal_swing]', value);
                return this._flowTriggerHorizontalSwingChanged.trigger(this, { horizontal_swing: value });
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.quiet, 'quiet_mode')) {
            const value = updatedProperties[HVAC.PROPERTY.quiet];
            this.setCapabilityValue('quiet_mode', value).then(() => {
                this.log('[update properties]', '[quiet_mode]', value);
                return this._flowTriggerQuietModeChanged.trigger(this, { quiet_mode: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, HVAC.PROPERTY.health, 'health_mode')) {
            const value = updatedProperties[HVAC.PROPERTY.health] === HVAC.VALUE.health.on;
            this.setCapabilityValue('health_mode', value).then(() => {
                this.log('[update properties]', '[health_mode]', value);
                return this._flowTriggerHealthModeChanged.trigger(this, { health_mode: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, HVAC.PROPERTY.powerSave, 'power_save_mode')) {
            const value = updatedProperties[HVAC.PROPERTY.powerSave] === HVAC.VALUE.powerSave.on;
            this.setCapabilityValue('power_save_mode', value).then(() => {
                this.log('[update properties]', '[power_save_mode]', value);
                return this._flowTriggerPowerSaveModeChanged.trigger(this, { power_save_mode: value });
            }).catch(this.error);
        }

        if (this._checkBoolPropertyChanged(updatedProperties, HVAC.PROPERTY.sleep, 'sleep_mode')) {
            const value = updatedProperties[HVAC.PROPERTY.sleep] === HVAC.VALUE.sleep.on;
            this.setCapabilityValue('sleep_mode', value).then(() => {
                this.log('[update properties]', '[sleep_mode]', value);
                return this._flowTriggerSleepModeChanged.trigger(this, { sleep_mode: value });
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.air, 'fresh_air_mode')) {
            const value = updatedProperties[HVAC.PROPERTY.air];
            this.setCapabilityValue('fresh_air_mode', value).then(() => {
                this.log('[update properties]', '[fresh_air_mode]', value);
                return this._flowTriggerFreshAirModeChanged.trigger(this, { fresh_air_mode: value });
            }).catch(this.error);
        }
    }

    _onError(message) {
        this.log('[ERROR]', 'Message:', message);

        this._markOffline();
    }

    _onDisconnect() {
        this.log('[disconnect]', 'Disconnecting from device');
        this._markOffline();
    }

    /**
     * No response received during polling process from HVAC within timeout period.
     * Seems HVAC is offline and doesn't answer on requests. Mark it as offline in Homey
     *
     * @private
     */
    _onNoResponse() {
        this.log('[no response]', 'Didn\'t get response during polling updates');
        this._markOffline();
        this._scheduleNoResponseReconnect();
    }

    /**
     * Schedule a full reconnect if the HVAC keeps not responding.
     * Covers the case when the HVAC changed its IP address (e.g. via DHCP):
     * the client would keep polling the old address forever,
     * so drop the connection and restart discovery instead.
     *
     * @private
     */
    _scheduleNoResponseReconnect() {
        if (this._noResponseReconnectTimeoutRef) {
            return;
        }

        const timeout = this._getSetting(SETTING.NO_RESPONSE_RECONNECT_TIMEOUT, DEFAULT_NO_RESPONSE_RECONNECT_TIMEOUT);

        this._noResponseReconnectTimeoutRef = this.homey.setTimeout(() => {
            this._noResponseReconnectTimeoutRef = null;
            this.log('[no response]', 'No response for too long. Reconnecting');
            this.reconnect();
        }, timeout);
    }

    /**
     * Cancel the scheduled reconnect, e.g. when the HVAC started responding again
     *
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
     * @private
     */
    _markOffline() {
        this.log('[offline] mark device offline');
        this.setUnavailable(this.homey.__('error.offline'));
    }

    /**
     * Start trying to find the device
     *
     * @private
     */
    _startLookingForDevice() {
        if (!this._lookingForDeviceIntervalRef) {
            this._lookingForDeviceIntervalRef = this.homey.setInterval(() => {
                this._findDevices();
            }, LOOKING_FOR_DEVICE_TIME_INTERVAL);
        }
        this._findDevices();
    }

    /**
     * Stop attempts of looking for a device
     */
    _stopLookingForDevice() {
        if (this._lookingForDeviceIntervalRef) {
            this.homey.clearInterval(this._lookingForDeviceIntervalRef);
            this._lookingForDeviceIntervalRef = null;
        }
    }

    /**
     * Check that properties from the HVAC and from the Homey capability changed
     *
     * @param {Array} updatedProperties
     * @param {string} propertyName
     * @param {string} capabilityName
     * @returns {boolean}
     * @private
     */
    _checkPropertyChanged(updatedProperties, propertyName, capabilityName) {
        if (!Object.prototype.hasOwnProperty.call(updatedProperties, propertyName)) {
            return false;
        }

        const hvacValue = updatedProperties[propertyName];
        const capabilityValue = this.getCapabilityValue(capabilityName);

        // If HVAC and Homey have different values then it was changed
        return hvacValue !== capabilityValue;
    }

    /**
     * Same as _checkPropertyChanged plus check if capability value is null and from HVAC is "0"
     * means no data available and should be considered as "no change"
     *
     * @param {Array} updatedProperties
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

        // Additional check for current temperature
        if (capabilityValue === null && hvacValue === 0) {
            return false;
        }

        // If HVAC and Homey have different values then it was changed
        return hvacValue !== capabilityValue;
    }

    /**
     * Special checks for boolean logic
     *
     * @param {Array} updatedProperties
     * @param {string} propertyName
     * @param {string} capabilityName
     * @returns {boolean}
     * @private
     */
    _checkBoolPropertyChanged(updatedProperties, propertyName, capabilityName) {
        if (!Object.prototype.hasOwnProperty.call(updatedProperties, propertyName)) {
            return false;
        }

        const propertyValue = updatedProperties[propertyName];
        const capabilityValue = this.getCapabilityValue(capabilityName);

        return compareBoolProperties(propertyValue, capabilityValue, HVAC.VALUE[propertyName].on);
    }

    /**
     * Try to disconnect _client,
     * remove all existing listeners
     * and delete _client property from the object
     *
     * @private
     */
    _tryToDisconnect() {
        if (this._client) {
            this._client.removeAllListeners();
            // disconnect() rejects when the client has no active socket
            // (e.g. in the middle of its own reconnect cycle)
            this._client.disconnect().catch(this.error);
            this._client = null;
        }
    }

    /**
     * Get static IP from the latest settings state (pending value included).
     *
     * @returns {string}
     * @private
     */
    _getStaticIpSetting() {
        const value = this._getSetting(SETTING.STATIC_IP);

        // The user may have entered the IP with surrounding whitespace
        return typeof value === 'string' ? value.trim() : value;
    }

    /**
     * Execute migration of capabilities for the device if available
     *
     * @returns {Promise<void>}
     */
    async _executeCapabilityMigrations() {
        // Added in v0.2.1
        if (!this.hasCapability('turbo_mode')) {
            this.log('[migration v0.2.1]', 'Adding "turbo_mode" capability');
            await this.addCapability('turbo_mode');
        }

        if (!this.hasCapability('lights')) {
            this.log('[migration v0.2.1]', 'Adding "lights" capability');
            await this.addCapability('lights');
        }

        // Added in v0.3.0
        if (!this.hasCapability('xfan_mode')) {
            this.log('[migration v0.3.0]', 'Adding "xfan_mode" capability');
            await this.addCapability('xfan_mode');
        }

        // Added in v0.3.0
        if (!this.hasCapability('vertical_swing')) {
            this.log('[migration v0.3.0]', 'Adding "vertical_swing" capability');
            await this.addCapability('vertical_swing');
        }

        // Added in v0.4.0
        if (!this.hasCapability('measure_temperature')) {
            this.log('[migration v0.4.0]', 'Adding "measure_temperature" capability');
            await this.addCapability('measure_temperature');
        }

        // Added in v0.5.0
        if (!this.hasCapability('thermostat_mode') && this.hasCapability('hvac_mode')) {
            this.log('[migration v0.5.0]', 'Converting "hvac_mode" to "thermostat_mode"');
            await this.removeCapability('hvac_mode');
            await this.addCapability('thermostat_mode');
        }

        // Added in v0.8.0 (test)
        if (!this.hasCapability('horizontal_swing')) {
            this.log('[migration v0.8.0]', 'Adding "horizontal_swing" capability');
            await this.addCapability('horizontal_swing');
        }

        if (!this.hasCapability('quiet_mode')) {
            this.log('[migration v0.8.0]', 'Adding "quiet_mode" capability');
            await this.addCapability('quiet_mode');
        }

        // Commented in v0.8.1
        // if (!this.hasCapability('hvac_mode')) {
        //     this.log('[migration]', 'Adding "hvac_mode" capability');
        //     await this.addCapability('hvac_mode');
        // }

        // Added in v0.8.1
        // Revert back from "hvac_mode" to "thermostat_mode"
        if (this.hasCapability('hvac_mode')) {
            this.log('[migration v0.8.1]', 'Removing "hvac_mode" capability');
            await this.removeCapability('hvac_mode');

            // Re-add thermostat_mode with new configuration
            if (this.hasCapability('thermostat_mode')) {
                this.log('[migration v0.8.1]', 'Removing "thermostat_mode" capability');
                await this.removeCapability('thermostat_mode');
            }

            this.log('[migration v0.8.1]', 'Adding "thermostat_mode" capability');
            await this.addCapability('thermostat_mode');
        }

        // Added in v0.9.4
        if (!this.hasCapability('safety_heating')) {
            this.log('[migration v0.9.4]', 'Adding "safety_heating" capability');
            await this.addCapability('safety_heating');
        }

        // Added in v0.13.0
        if (!this.hasCapability('health_mode')) {
            this.log('[migration v0.13.0]', 'Adding "health_mode" capability');
            await this.addCapability('health_mode');
        }

        // Added in v1.0.0
        if (!this.hasCapability('power_save_mode')) {
            this.log('[migration v1.0.0]', 'Adding "power_save_mode" capability');
            await this.addCapability('power_save_mode');
        }

        if (!this.hasCapability('sleep_mode')) {
            this.log('[migration v1.0.0]', 'Adding "sleep_mode" capability');
            await this.addCapability('sleep_mode');
        }

        if (!this.hasCapability('fresh_air_mode')) {
            this.log('[migration v1.0.0]', 'Adding "fresh_air_mode" capability');
            await this.addCapability('fresh_air_mode');
        }
    }

    async _executeDeviceClassMigration() {
        if (this.getClass() !== 'airconditioning') {
            await this.setClass('airconditioning').catch(this.error);
        }
    }

    /**
     * Get the MAC address of the HVAC.
     *
     * Devices paired via "Skip UDP scan" have no MAC in the immutable device
     * data (older versions stored the IP address there instead). For them the
     * real MAC, resolved on the first successful connection, is kept in the
     * device store.
     *
     * @returns {string|undefined}
     */
    getMac() {
        return this.getStoreValue('mac') || this.getData().mac;
    }

    /**
     * Persist the real MAC reported by the connected HVAC for devices
     * paired via "Skip UDP scan": they have either no MAC at all or,
     * for devices paired by older app versions, the IP address as a
     * placeholder MAC. This makes MAC-based discovery work for them,
     * e.g. after the static IP setting is cleared.
     *
     * A real MAC obtained during pairing is never overwritten: discovery
     * matches on the MAC broadcast by the device, while getDeviceId()
     * returns the client cid, which is not guaranteed to be identical.
     *
     * @param {HVAC.Client} client
     * @private
     */
    _updateMacFromClient(client) {
        const knownMac = this.getMac();

        if (knownMac && !isValidIpv4(knownMac)) {
            return;
        }

        const mac = client.getDeviceId();

        if (!mac || mac === knownMac) {
            return;
        }

        this.log('[connect]', 'Updating stored mac to:', mac);
        this.setStoreValue('mac', mac).catch(this.error);
    }

    /**
     * Get the latest known HVAC properties in the API format.
     * Returns an empty object when the client is not connected,
     * e.g. while the device is still being discovered or is reconnecting.
     *
     * @returns {Object}
     * @private
     */
    _getCurrentClientProperties() {
        if (!this._client) {
            return {};
        }

        return this._client._transformer.fromVendor(this._client._properties);
    }

    /**
     * Set value for the specific property of the HVAC _client.
     *
     * Rejects when the command could not be delivered to the HVAC — either
     * because the client is not connected, or because the underlying
     * `setProperty` call fails (e.g. the socket is gone while the client
     * object still exists during a reconnect, yielding ClientNotConnectedError).
     * Capability listeners propagate this rejection so Homey reverts the
     * capability to its previous value.
     *
     * @param property
     * @param value
     * @returns {Promise<void>} resolves once the command was sent to the HVAC
     * @private
     */
    async _setClientProperty(property, value) {
        if (!this._client) {
            this.log('[set property]', `Skip setting "${property}". Client is not connected`);
            throw new Error(this.homey.__('error.not_connected'));
        }

        try {
            await this._client.setProperty(property, value);
        } catch (err) {
            this.log('[set property]', `Failed to set "${property}":`, err.message);
            throw new Error(this.homey.__('error.not_connected'));
        }
    }

    reconnect() {
        this.log('Reconnecting to the HVAC');
        this._cancelNoResponseReconnect();
        this._markOffline();
        this._tryToDisconnect();
        this._startLookingForDevice();
    }

}

module.exports = GreeHVACDevice;
