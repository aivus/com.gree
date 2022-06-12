'use strict';

const Homey = require('homey');
const HVAC = require('gree-hvac-client');
const finder = require('./network/finder');

// Interval between trying to found HVAC in network (ms)
const RECONNECT_TIME_INTERVAL = 10000;

// Interval between polling status from HVAC (ms)
const POLLING_INTERVAL = 3500;

// Timeout for response from the HVAC during polling process (ms)
const POLLING_TIMEOUT = 3000;

class GreeHVACDevice extends Homey.Device {

    async onInit() {
        this.log('Gree device has been inited');

        this._flowTriggerHvacFanSpeedChanged = this.homey.flow.getDeviceTriggerCard('fan_speed_changed');
        this._flowTriggerHvacModeChanged = this.homey.flow.getDeviceTriggerCard('hvac_mode_changed');
        this._flowTriggerTurboModeChanged = this.homey.flow.getDeviceTriggerCard('turbo_mode_changed');
        this._flowTriggerHvacLightsChanged = this.homey.flow.getDeviceTriggerCard('lights_changed');
        this._flowTriggerXFanModeChanged = this.homey.flow.getDeviceTriggerCard('xfan_mode_changed');
        this._flowTriggerVerticalSwingChanged = this.homey.flow.getDeviceTriggerCard('vertical_swing_changed');

        this._markOffline();
        this._findDevices();
        this._scheduleReconnection();
    }

    /**
     * Device was removed from Homey. Cleanup, remove all listeners, disconnect from the HVAC
     */
    onDeleted() {
        this.log('[on deleted]', 'Gree device has been deleted. Disconnecting client.');

        this._tryToDisconnect();

        if (this._reconnectInterval) {
            this.homey.clearInterval(this._reconnectInterval);
            delete this._reconnectInterval;
        }

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
        const deviceData = this.getData();
        const settings = this.getSettings();

        this.log('[find devices]', 'Finding device with mac:', deviceData.mac);

        finder.hvacs.forEach(hvac => {
            if (hvac.message.mac !== deviceData.mac) {
                // Skip other HVACs from the finder until find current
                this.log('[find devices]', 'Skipping HVAC with mac:', hvac.message.mac);
                return;
            }

            this.log('[find devices]', 'Connecting to device with mac:', hvac.message.mac);

            // Disconnect in case of client exists
            this._tryToDisconnect();

            this.client = new HVAC.Client({
                debug: settings.enable_debug,
                host: hvac.remoteInfo.address,
                pollingInterval: POLLING_INTERVAL,
                pollingTimeout: POLLING_TIMEOUT,
            });

            this._addMissedCapabilities().then(() => {
                this._registerClientListeners();
                this._registerCapabilities();
            });
        });
    }

    /**
     * Register all applicable event listeners to the HVAC Client instance
     *
     * @private
     */
    _registerClientListeners() {
        this.client.on('error', this._onError.bind(this));
        this.client.on('disconnect', this._onDisconnect.bind(this));
        this.client.on('connect', this._onConnect.bind(this));
        this.client.on('update', this._onUpdate.bind(this));
        this.client.on('no_response', this._onNoResponse.bind(this));
    }

    /**
     * Register all applicable capabilities
     *
     * @private
     */
    _registerCapabilities() {
        this.registerCapabilityListener('onoff', value => {
            const rawValue = value ? HVAC.VALUE.power.on : HVAC.VALUE.power.off;
            this.log('[power mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this.client.setProperty(HVAC.PROPERTY.power, rawValue);

            return Promise.resolve();
        });

        this.registerCapabilityListener('target_temperature', value => {
            this.log('[temperature change]', `Value: ${value}`);
            this.client.setProperty(HVAC.PROPERTY.temperature, value);

            return Promise.resolve();
        });

        this.registerCapabilityListener('thermostat_mode', value => {
            const rawValue = HVAC.VALUE.mode[value];
            this.log('[mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this._flowTriggerHvacModeChanged.trigger(this, { hvac_mode: value });
            this.client.setProperty(HVAC.PROPERTY.mode, rawValue);
            return Promise.resolve();
        });

        this.registerCapabilityListener('fan_speed', value => {
            const rawValue = HVAC.VALUE.fanSpeed[value];
            this.log('[fan speed change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this.client.setProperty(HVAC.PROPERTY.fanSpeed, rawValue);
            return Promise.resolve();
        });

        this.registerCapabilityListener('turbo_mode', value => {
            const rawValue = value ? HVAC.VALUE.turbo.on : HVAC.VALUE.turbo.off;
            this.log('[turbo mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this.client.setProperty(HVAC.PROPERTY.turbo, rawValue);
            return Promise.resolve();
        });

        this.registerCapabilityListener('lights', value => {
            const rawValue = value ? HVAC.VALUE.lights.on : HVAC.VALUE.lights.off;
            this.log('[lights change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this.client.setProperty(HVAC.PROPERTY.lights, rawValue);
            this._flowTriggerHvacLightsChanged.trigger(this, { lights: value });
            return Promise.resolve();
        });

        this.registerCapabilityListener('xfan_mode', value => {
            const rawValue = value ? HVAC.VALUE.blow.on : HVAC.VALUE.blow.off;
            this.log('[xfan mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this.client.setProperty(HVAC.PROPERTY.blow, rawValue);
            this._flowTriggerXFanModeChanged.trigger(this, { xfan_mode: value });
            return Promise.resolve();
        });

        this.registerCapabilityListener('vertical_swing', value => {
            const rawValue = HVAC.VALUE.swingVert[value];
            this.log('[vertical swing change]', `Value: ${value}`, `Raw value: ${rawValue}`);
            this.client.setProperty(HVAC.PROPERTY.swingVert, rawValue);
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
        this.homey.clearInterval(this._reconnectInterval);
        delete this._reconnectInterval;
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

        this.homey.clearInterval(this._reconnectInterval);
        delete this._reconnectInterval;

        this.log('[update]', 'mark device available');
        this.setAvailable();

        if (this._checkBoolPropertyChanged(updatedProperties, HVAC.PROPERTY.power, 'onoff')) {
            const value = updatedProperties[HVAC.PROPERTY.power] === HVAC.VALUE.power.on;
            this.setCapabilityValue('onoff', value).then(() => {
                this.log('[update properties]', '[onoff]', value);
                return Promise.resolve();
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.temperature, 'target_temperature')) {
            const value = updatedProperties[HVAC.PROPERTY.temperature];
            this.setCapabilityValue('target_temperature', value).then(() => {
                this.log('[update properties]', '[target_temperature]', value);
                return Promise.resolve();
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.currentTemperature, 'measure_temperature')) {
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
            const value = updatedProperties[HVAC.PROPERTY.mode];
            this.setCapabilityValue('thermostat_mode', value).then(() => {
                this.log('[update properties]', '[hvac_mode]', value);
                return this._flowTriggerHvacModeChanged.trigger(this, { hvac_mode: value });
            }).catch(this.error);
        }

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.fanSpeed, 'fan_speed')) {
            const value = updatedProperties[HVAC.PROPERTY.fanSpeed];
            this.setCapabilityValue('fan_speed', value).then(() => {
                this.log('[update properties]', '[fan_speed]', value);
                return Promise.resolve();
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
                return Promise.resolve();
            }).catch(this.error);
        }
    }

    _onError(message, error) {
        this.log('[ERROR]', 'Message:', message, 'Error', error);
        this._markOffline();
        this._scheduleReconnection();
    }

    _onDisconnect() {
        this.log('[disconnect]', 'Disconnecting from device');
        this._markOffline();
        this._scheduleReconnection();
    }

    /**
     * No response received during polling process from HVAC within timeout period.
     * Seems HVAC is offline and doesn't answer on requests. Mark it as offline in Homey
     *
     * @param {HVAC.Client} client
     * @private
     */
    _onNoResponse(client) {
        this.log('[no response]', 'Don\'t get response during polling updates');
        this._markOffline();
        this._scheduleReconnection();
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
     *
     * @private
     */
    _scheduleReconnection() {
        if (!this._reconnectInterval) {
            this._reconnectInterval = this.homey.setInterval(() => {
                this._findDevices();
            }, RECONNECT_TIME_INTERVAL);
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
     * Try to disconnect client,
     * remove all existing listeners
     * and delete client property from the object
     *
     * @private
     */
    _tryToDisconnect() {
        if (this.client) {
            this.client.disconnect();
            this.client.removeAllListeners();
            delete this.client;
        }
    }

    async _addMissedCapabilities() {
        // Skip adding if it's Homey's version < 3.0.0.
        if (typeof this.addCapability !== 'function') {
            return;
        }

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
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (changedKeys.indexOf('enable_debug') > -1) {
            console.log('Changing the debug settings from', oldSettings.enable_debug, 'to', newSettings.enable_debug);
            this.client.setDebug(newSettings.enable_debug);
        }
    }

}

/**
 * Compare boolean properties
 *
 * @param {string} propertyValue
 * @param {string} capabilityValue
 * @param {string} trueValue
 * @returns {boolean}
 */
function compareBoolProperties(propertyValue, capabilityValue, trueValue) {
    const changedFromTrueToFalse = capabilityValue && propertyValue !== trueValue;
    const changedFromFalseToTrue = !capabilityValue && propertyValue === trueValue;

    return changedFromFalseToTrue || changedFromTrueToFalse;
}

module.exports = GreeHVACDevice;
