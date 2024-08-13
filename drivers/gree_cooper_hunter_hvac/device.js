'use strict';

const Homey = require('homey');
const HVAC = require('gree-hvac-client');
const finder = require('./network/finder');
const { compareBoolProperties } = require('../../utils');

// Interval between trying to found HVAC in network (ms)
const LOOKING_FOR_DEVICE_TIME_INTERVAL = 5000;

// Interval between polling status from HVAC (ms)
const POLLING_INTERVAL = 3500;

// Timeout for response from the HVAC during polling process (ms)
const POLLING_TIMEOUT = 3000;

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

    async onInit() {
        this.log('Gree device has been inited');

        this._flowTriggerHvacFanSpeedChanged = this.homey.flow.getDeviceTriggerCard('fan_speed_changed');
        this._flowTriggerHvacModeChanged = this.homey.flow.getDeviceTriggerCard('hvac_mode_changed');
        this._flowTriggerTurboModeChanged = this.homey.flow.getDeviceTriggerCard('turbo_mode_changed');
        this._flowTriggerHvacLightsChanged = this.homey.flow.getDeviceTriggerCard('lights_changed');
        this._flowTriggerXFanModeChanged = this.homey.flow.getDeviceTriggerCard('xfan_mode_changed');
        this._flowTriggerVerticalSwingChanged = this.homey.flow.getDeviceTriggerCard('vertical_swing_changed');
        this._flowTriggerHorizontalSwingChanged = this.homey.flow.getDeviceTriggerCard('horizontal_swing_changed');
        this._flowTriggerQuietModeChanged = this.homey.flow.getDeviceTriggerCard('quiet_mode_changed');

        await this._executeCapabilityMigrations();
        this._registerCapabilityListeners();

        this._markOffline();
        this._startLookingForDevice();
    }

    /**
     * Device was removed from Homey. Cleanup, remove all listeners, disconnect from the HVAC
     */
    onDeleted() {
        this.log('[on deleted]', 'Gree device has been deleted. Disconnecting _client.');

        this._stopLookingForDevice();
        this._tryToDisconnect();

        this.log('[on deleted]', 'Cleanup after removing done');
    }

    /**
     * Check all available HVACs from the Finder module
     * and try to find one which will work with this Device instance
     * based on MAC address
     *
     * @private
     */
    _findDevices() {
        if (this._client) {
            return;
        }

        const deviceData = this.getData();
        const settings = this.getSettings();

        this.log('[find devices]', 'Finding device with mac:', deviceData.mac);

        finder.hvacs.forEach((hvac) => {
            if (hvac.message.mac !== deviceData.mac) {
                // Skip other HVACs from the finder until find current
                this.log('[find devices]', 'Skipping HVAC with mac:', hvac.message.mac);
                return;
            }

            this.log('[find devices]', 'Connecting to device with mac:', hvac.message.mac);

            this._stopLookingForDevice();

            this._client = new HVAC.Client({
                debug: settings.enable_debug,
                host: hvac.remoteInfo.address,
                pollingInterval: POLLING_INTERVAL,
                pollingTimeout: POLLING_TIMEOUT,
            });

            this._registerClientListeners();
        });
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
        this.registerCapabilityListener('onoff', (value) => {
            const rawValue = value ? HVAC.VALUE.power.on : HVAC.VALUE.power.off;
            this.log('[power mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this._setClientProperty(HVAC.PROPERTY.power, rawValue);

            if (rawValue === HVAC.VALUE.power.off) {
                // Set Thermostat mode to Off.
                this.setCapabilityValue('thermostat_mode', 'off');
            } else {
                // Restore thermostat_mode.
                const properties = this._client._transformer.fromVendor(this._client._properties);
                this.setCapabilityValue('thermostat_mode', HVAC.VALUE.mode[properties[HVAC.PROPERTY.mode]]);
            }

            return Promise.resolve();
        });

        this.registerCapabilityListener('target_temperature', (value) => {
            this.log('[temperature change]', `Value: ${value}`);
            this._setClientProperty(HVAC.PROPERTY.temperature, value);

            return Promise.resolve();
        });

        this.registerCapabilityListener('thermostat_mode', (value) => {
            if (value === 'off') {
                this.log('[power mode change]', `Value: ${value}`);
                this._setClientProperty(HVAC.PROPERTY.power, HVAC.VALUE.power.off);
                this.setCapabilityValue('onoff', false);
            } else {
                const rawValue = HVAC.VALUE.mode[value];
                this.log('[thermostat_mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
                this._setClientProperty(HVAC.PROPERTY.mode, rawValue);
                this.setCapabilityValue('hvac_mode', rawValue);

                // Turn on if needed.
                const properties = this._client._transformer.fromVendor(this._client._properties);
                if (properties[HVAC.PROPERTY.power] === HVAC.VALUE.power.off) {
                    this.setCapabilityValue('onoff', true);
                    this._setClientProperty(HVAC.PROPERTY.power, HVAC.VALUE.power.on);
                }
            }

            return Promise.resolve();
        });

        this.registerCapabilityListener('hvac_mode', (value) => {
            let rawValue = HVAC.VALUE.mode[value];
            this.log('[hvac_mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this._setClientProperty(HVAC.PROPERTY.mode, rawValue);
            this._flowTriggerHvacModeChanged.trigger(this, { hvac_mode: rawValue });

            // Update thermostat_mode when on
            if (this.getCapabilityValue('onoff') === true) {
                // Homey doesn't support fan_only or dry
                if (rawValue === 'fan_only') {
                    rawValue = 'off';
                } else if (value === 'dry') {
                    rawValue = 'cool';
                }

                this.setCapabilityValue('thermostat_mode', rawValue);
            }

            return Promise.resolve();
        });

        this.registerCapabilityListener('fan_speed', (value) => {
            const rawValue = HVAC.VALUE.fanSpeed[value];
            this.log('[fan speed change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this._setClientProperty(HVAC.PROPERTY.fanSpeed, rawValue);
            this._flowTriggerHvacFanSpeedChanged.trigger(this, { fan_speed: value });

            return Promise.resolve();
        });

        this.registerCapabilityListener('turbo_mode', (value) => {
            const rawValue = value ? HVAC.VALUE.turbo.on : HVAC.VALUE.turbo.off;
            this.log('[turbo mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this._setClientProperty(HVAC.PROPERTY.turbo, rawValue);
            this._flowTriggerTurboModeChanged.trigger(this, { turbo_mode: value });

            return Promise.resolve();
        });

        this.registerCapabilityListener('lights', (value) => {
            const rawValue = value ? HVAC.VALUE.lights.on : HVAC.VALUE.lights.off;
            this.log('[lights change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this._setClientProperty(HVAC.PROPERTY.lights, rawValue);
            this._flowTriggerHvacLightsChanged.trigger(this, { lights: value });

            return Promise.resolve();
        });

        this.registerCapabilityListener('xfan_mode', (value) => {
            const rawValue = value ? HVAC.VALUE.blow.on : HVAC.VALUE.blow.off;
            this.log('[xfan mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this._setClientProperty(HVAC.PROPERTY.blow, rawValue);
            this._flowTriggerXFanModeChanged.trigger(this, { xfan_mode: value });

            return Promise.resolve();
        });

        this.registerCapabilityListener('vertical_swing', (value) => {
            const rawValue = HVAC.VALUE.swingVert[value];
            this.log('[vertical swing change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this._setClientProperty(HVAC.PROPERTY.swingVert, rawValue);
            this._flowTriggerVerticalSwingChanged.trigger(this, { vertical_swing: value });

            return Promise.resolve();
        });

        this.registerCapabilityListener('horizontal_swing', (value) => {
            const rawValue = HVAC.VALUE.swingHor[value];
            this.log('[horizontal swing change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this._setClientProperty(HVAC.PROPERTY.swingHor, rawValue);
            this._flowTriggerHorizontalSwingChanged.trigger(this, { horizontal_swing: value });

            return Promise.resolve();
        });

        this.registerCapabilityListener('quiet_mode', (value) => {
            const rawValue = HVAC.VALUE.quiet[value];
            this.log('[quiet mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this._setClientProperty(HVAC.PROPERTY.quiet, rawValue);
            this._flowTriggerQuietModeChanged.trigger(this, { quiet_mode: value });

            return Promise.resolve();
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

        if (!this.getAvailable()) {
            this.log('[update]', 'mark device available');
            this.setAvailable();

            // Ensure that thermostat_mode is properly set in Homey when device becomes available.
            if (properties[HVAC.PROPERTY.power] === HVAC.VALUE.power.off && this.getCapabilityValue('thermostat_mode') !== 'off') {
                updatedProperties[HVAC.PROPERTY.mode] = 'off';
            }
        }

        if (this._checkBoolPropertyChanged(updatedProperties, HVAC.PROPERTY.power, 'onoff')) {
            const value = updatedProperties[HVAC.PROPERTY.power] === HVAC.VALUE.power.on;
            this.setCapabilityValue('onoff', value).then(() => {
                this.log('[update properties]', '[onoff]', value);
                return Promise.resolve();
            }).catch(this.error);

            if (!value) {
                // Set Homey thermostat mode to Off when turned off.
                this.setCapabilityValue('thermostat_mode', 'off').then(() => {
                    this.log('[update properties]', '[thermostat_mode]', 'off');
                }).catch(this.error);
            } else {
                // Restore Homey thermostat mode when turned on.
                let restoredHvacMode = updatedProperties[HVAC.PROPERTY.mode] === undefined ? properties[HVAC.PROPERTY.mode] : updatedProperties[HVAC.PROPERTY.mode];

                this.setCapabilityValue('hvac_mode', restoredHvacMode).then(() => {
                    this.log('[update properties]', '[hvac_mode]', restoredHvacMode);
                    return this._flowTriggerHvacModeChanged.trigger(this, { hvac_mode: restoredHvacMode });
                }).catch(this.error);

                // Homey thermostat doesn't support fan_only or dry
                if (restoredHvacMode === 'fan_only') {
                    restoredHvacMode = 'off';
                } else if (restoredHvacMode === 'dry') {
                    restoredHvacMode = 'cool';
                }

                this.setCapabilityValue('thermostat_mode', restoredHvacMode).then(() => {
                    this.log('[update properties]', '[thermostat_mode]', restoredHvacMode);
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

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.mode, 'hvac_mode')) {
            const value = updatedProperties[HVAC.PROPERTY.mode];

            // Update thermostat_mode
            if (properties[HVAC.PROPERTY.power] === HVAC.VALUE.power.off) {
                // When HVAC is off, thermostat_mode should be always "off".
                if (this.getCapabilityValue('thermostat_mode') !== 'off') {
                    this.setCapabilityValue('thermostat_mode', 'off').then(() => {
                        this.log('[update properties]', '[thermostat_mode]', 'off');
                    }).catch(this.error);
                }
            } else {
                let thermostatValue = updatedProperties[HVAC.PROPERTY.mode];

                // Homey doesn't support fan_only or dry
                if (thermostatValue === 'fan_only') {
                    thermostatValue = 'off';
                } else if (value === 'dry') {
                    thermostatValue = 'cool';
                }

                this.setCapabilityValue('thermostat_mode', thermostatValue).then(() => {
                    this.log('[update properties]', '[thermostat_mode]', thermostatValue);
                }).catch(this.error);
            }

            this.setCapabilityValue('hvac_mode', value).then(() => {
                this.log('[update properties]', '[hvac_mode]', value);
                return this._flowTriggerHvacModeChanged.trigger(this, { hvac_mode: value });
            }).catch(this.error);
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
    }

    _onError(message, error) {
        this.log('[ERROR]', 'Message:', message, 'Error', error);
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

        // TODO: Start timeout to do a manual reconnect if no response for long time
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
            this._client.disconnect();
            this._client = null;
        }
    }

    /**
     * Execute migration of capabilities for the device if available
     *
     * @returns {Promise<void>}
     */
    async _executeCapabilityMigrations() {
        // Added in v0.2.1
        if (!this.hasCapability('turbo_mode')) {
            this.log('[migration]', 'Adding "turbo_mode" capability');
            await this.addCapability('turbo_mode');
        }

        // Added in v0.2.1
        if (!this.hasCapability('lights')) {
            this.log('[migration]', 'Adding "lights" capability');
            await this.addCapability('lights');
        }

        // Added in v0.3.0
        if (!this.hasCapability('xfan_mode')) {
            this.log('[migration]', 'Adding "xfan_mode" capability');
            await this.addCapability('xfan_mode');
        }

        // Added in v0.3.0
        if (!this.hasCapability('vertical_swing')) {
            this.log('[migration]', 'Adding "vertical_swing" capability');
            await this.addCapability('vertical_swing');
        }

        // Added in v0.4.0
        if (!this.hasCapability('measure_temperature')) {
            this.log('[migration]', 'Adding "measure_temperature" capability');
            await this.addCapability('measure_temperature');
        }

        // Added in v0.5.0
        if (!this.hasCapability('thermostat_mode') && this.hasCapability('hvac_mode')) {
            this.log('[migration]', 'Converting "hvac_mode" to "thermostat_mode"');
            await this.removeCapability('hvac_mode');
            await this.addCapability('thermostat_mode');
        }

        // Added in v0.8.0
        if (!this.hasCapability('horizontal_swing')) {
            this.log('[migration]', 'Adding "horizontal_swing" capability');
            await this.addCapability('horizontal_swing');
        }

        if (!this.hasCapability('quiet_mode')) {
            this.log('[migration]', 'Adding "quiet_mode" capability');
            await this.addCapability('quiet_mode');
        }

        if (!this.hasCapability('hvac_mode')) {
            this.log('[migration]', 'Adding "hvac_mode" capability');
            await this.addCapability('hvac_mode');
        }

        // Added in v0.8.1
        if (this.hasCapability('hvac_mode') && this.hasCapability('thermostat_mode')) {
            this.log('[migration]', 'Re-add "thermostat_mode" capability');
            await this.removeCapability('thermostat_mode');
            await this.addCapability('thermostat_mode');
        }
    }

    /**
     * Set value for the specific property of the HVAC _client
     *
     * @param property
     * @param value
     * @private
     */
    _setClientProperty(property, value) {
        if (this._client) {
            this._client.setProperty(property, value);
        }
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (changedKeys.indexOf('enable_debug') > -1) {
            console.log('Changing the debug settings from', oldSettings.enable_debug, 'to', newSettings.enable_debug);
            if (this._client) {
                this._client.setDebug(newSettings.enable_debug);
            } else {
                return Promise.reject();
            }
        }

        return Promise.resolve();
    }

}

module.exports = GreeHVACDevice;
