'use strict';

const Homey = require('homey');
const HVAC = require('gree-hvac-client');
const finder = require('./network/finder');

// Interval between trying to found HVAC in network (ms)
const RECONNECT_TIME_INTERVAL = 10000;

// Interval between polling status from HVAC (ms)
const POLLING_INTERVAL = 3000;

// Timeout for response from the HVAC during polling process (ms)
const POLLING_TIMEOUT = 2000;

// Debugging mode (for development)
const DEBUG = false;

class GreeHVACDevice extends Homey.Device {

    onInit() {
        this.log('Gree device has been inited');

        this._flowTriggerHvacFanSpeedChanged = new Homey.FlowCardTriggerDevice('fan_speed_changed').register();
        this._flowTriggerHvacModeChanged = new Homey.FlowCardTriggerDevice('hvac_mode_changed').register();
        this._flowTriggerTurboModeChanged = new Homey.FlowCardTriggerDevice('turbo_mode_changed').register();
        this._flowTriggerHvacLightsChanged = new Homey.FlowCardTriggerDevice('lights_changed').register();

        this._markOffline();
        this._findDevices();
    }

    /**
     * Device was removed from Homey. Cleanup, remove all listeners, disconnect from the HVAC
     */
    onDeleted() {
        this.log('[on deleted]', 'Gree device has been deleted. Disconnecting client.');

        this._tryToDisconnect();

        if (this._reconnectInterval) {
            clearInterval(this._reconnectInterval);
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
                debug: DEBUG,
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

        this.registerCapabilityListener('hvac_mode', value => {
            const rawValue = HVAC.VALUE.mode[value];
            this.log('[mode change]', `Value: ${value}`, `Raw value: ${rawValue}`);
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
            return Promise.resolve();
        });
    }

    /**
     * App is sucessfuly connected to the HVAC
     * Mark device as available in Homey
     *
     * @param {HVAC.Client} client
     * @private
     */
    _onConnect(client) {
        this.log('[connect]', 'connected to', client.getDeviceId());
        clearInterval(this._reconnectInterval);
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

        // this.log(updatedProperties, properties);

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

        if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.mode, 'hvac_mode')) {
            const value = updatedProperties[HVAC.PROPERTY.mode];
            this.setCapabilityValue('hvac_mode', value).then(() => {
                this.log('[update properties]', '[hvac_mode]', value);
                return Promise.resolve();
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
     * @param {HVAC.Client} client
     * @private
     */
    _onNoResponse(client) {
        this._markOffline();
        this.log('[no response]', 'Don\'t get response during polling updates');
    }

    /**
     * Mark the device as offline in Homey
     *
     * @private
     */
    _markOffline() {
        this.log('[offline] mark device offline');
        this.setUnavailable(Homey.__('error.offline'));

        if (!this._reconnectInterval) {
            this._reconnectInterval = setInterval(() => {
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

        if (!this.hasCapability('hvac_mode')) {
            await this.addCapability('hvac_mode');
        }

        if (!this.hasCapability('fan_speed')) {
            await this.addCapability('fan_speed');
        }

        if (!this.hasCapability('turbo_mode')) {
            await this.addCapability('turbo_mode');
        }

        if (!this.hasCapability('lights')) {
            await this.addCapability('lights');
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
