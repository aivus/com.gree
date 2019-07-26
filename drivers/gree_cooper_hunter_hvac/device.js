'use strict';

const Homey = require('homey');
const finder = require('./network/finder');
const HVAC = require('gree-hvac-client');

// Interval between trying to found HVAC in network (ms)
const RECONNECT_TIME_INTERVAL = 10000;

// Interval between polling status from HVAC (ms)
const POLLING_INTERVAL = 3000;

// Timeout for response from the HVAC during polling process (ms)
const POLLING_TIMEOUT = 1500;

// Debugging mode (for development)
const DEBUG = false;

const PROP_CHANGED_HANDLERS = [
    {
        propertyName: HVAC.PROPERTY.temperature,
        capabilityName: 'target_temperature'
    },
    {
        propertyName: HVAC.PROPERTY.mode,
        capabilityName: 'hvac_mode',
        triggerName: '_flowTriggerHvacModeChanged' //todo: rework this?
    },
    {
        propertyName: HVAC.PROPERTY.fanSpeed,
        capabilityName: 'fan_speed',
        triggerName: '_flowTriggerHvacFanSpeedChanged'
    }
];

class GreeHVACDevice extends Homey.Device {
    onInit() {
        this.log('Gree device has been initiated');

        this._flowTriggerHvacFanSpeedChanged = new Homey.FlowCardTriggerDevice('fan_speed_changed').register();
        this._flowTriggerHvacModeChanged = new Homey.FlowCardTriggerDevice('hvac_mode_changed').register();

        this._markOffline();
        this._findDevices();
        this._reconnectInterval = setInterval(() => {
            this._findDevices();
        }, RECONNECT_TIME_INTERVAL);
    }

    /**
     * Device was removed from Homey. Cleanup, remove all listeners, disconnect from the HVAC
     */
    onDeleted() {
        this.log('[on deleted]', 'Gree device has been deleted. Disconnecting client.');

        if (this.client) {
            this.client.disconnect();
            this.client.removeAllListeners();
            delete this.client;
        }

        if (this._reconnectInterval) {
            clearInterval(this._reconnectInterval);
            delete this._reconnectInterval;
        }

        this.log('[on deleted]', 'Cleanup after removing done');
    }

    /**
     * Check all available HVACs from the Finder module and try to find one which will work with this Device instance
     * based on MAC address
     *
     * @private
     */
    _findDevices() {
        this.log('[find devices]', 'Trying to find devices');
        const deviceData = this.getData();

        finder.hvacs.forEach((hvac) => {
            if (hvac.message.mac !== deviceData.mac) {
                // Skip other HVACs from the finder until find current
                return;
            }

            this.client = new HVAC.Client({
                debug: DEBUG,
                host: hvac.remoteInfo.address,
                pollingInterval: POLLING_INTERVAL,
                pollingTimeout: POLLING_TIMEOUT
            });

            this._registerClientListeners();
            this._registerCapabilities();
        });
    }

    /**
     * Register all applicable event listeners to the HVAC Client instance
     *
     * @private
     */
    _registerClientListeners() {
        this.client.on('error', this._onError.bind(this));
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
        this.registerCapabilityListener('onoff', async (value) => {
            const rawValue = value ? HVAC.VALUE.power.on : HVAC.VALUE.power.off;
            this.log('[power mode change]', 'Value: ' + value, 'Raw value: ' + rawValue);
            this.client.setProperty(HVAC.PROPERTY.power, rawValue)
        });

        this.registerCapabilityListener('target_temperature', async (value) => {
            this.log('[temperature change]', 'Value: ' + value);
            this.client.setProperty(HVAC.PROPERTY.temperature, value)
        });

        this.registerCapabilityListener('hvac_mode', async (value) => {
            const rawValue = HVAC.VALUE.mode[value];
            this.log('[mode change]', 'Value: ' + value, 'Raw value: ' + rawValue);
            this.client.setProperty(HVAC.PROPERTY.mode, rawValue)
        });

        this.registerCapabilityListener('fan_speed', async (value) => {
            const rawValue = HVAC.VALUE.fanSpeed[value];
            this.log('[fan speed change]', 'Value: ' + value, 'Raw value: ' + rawValue);
            this.client.setProperty(HVAC.PROPERTY.fanSpeed, rawValue)
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
        clearInterval(this._reconnectInterval);
        delete this._reconnectInterval;
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

        this.setAvailable();

        if (this._checkOnOffPowerPropertyChanged(updatedProperties)) {
            const value = updatedProperties[HVAC.PROPERTY.power] === HVAC.VALUE.power.on;
            this.setCapabilityValue('onoff', value).catch(this.error);
            this.log('[update properties]', '[onoff]', value);
        }

        /** v3 **/
        PROP_CHANGED_HANDLERS.forEach(p => {
            this._updatePropertyIfChanged(updatedProperties, p.propertyName, p.capabilityName, p.triggerName);
        });

        /** v2 **/
        // this._updatePropertyIfChanged(updatedProperties, HVAC.PROPERTY.temperature, 'target_temperature');
        // this._updatePropertyIfChanged(updatedProperties, HVAC.PROPERTY.mode, 'hvac_mode', '_flowTriggerHvacModeChanged');
        // this._updatePropertyIfChanged(updatedProperties, HVAC.PROPERTY.fanSpeed, 'fan_speed', '_flowTriggerHvacFanSpeedChanged');

        /** v1 **/
        // if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.temperature, 'target_temperature')) {
        //     const value = updatedProperties[HVAC.PROPERTY.temperature];
        //     this.setCapabilityValue('target_temperature', value).catch(this.error);
        //     this.log('[update properties]', '[target_temperature]', value);
        // }
        //
        // if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.mode, 'hvac_mode')) {
        //     const value = updatedProperties[HVAC.PROPERTY.mode];
        //     this.setCapabilityValue('hvac_mode', value).catch(this.error);
        //     this.log('[update properties]', '[hvac_mode]', value);
        //     this._flowTriggerHvacModeChanged.trigger(this).catch(this.error);
        // }
        //
        // if (this._checkPropertyChanged(updatedProperties, HVAC.PROPERTY.fanSpeed, 'fan_speed')) {
        //     const value = updatedProperties[HVAC.PROPERTY.fanSpeed];
        //     this.setCapabilityValue('fan_speed', value).catch(this.error);
        //     this.log('[update properties]', '[fan_speed]', value);
        //     this._flowTriggerHvacFanSpeedChanged.trigger(this).catch(this.error);
        // }
    }

    _updatePropertyIfChanged(updatedProperties, propName, capName, triggerName) {
        if (this._checkPropertyChanged(updatedProperties, propName, capName)) {
            const value = updatedProperties[propName];
            this.setCapabilityValue(capName, value).catch(this.error);
            this.log('[update properties]', `[${capName}]`, value);
            triggerName && this[triggerName] && this[triggerName].trigger(this).catch(this.error);
        }
    }

    _onError(message, error) {
        this.log('[ERROR]', 'Message:', message, 'Error', error);
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
        if (!updatedProperties.hasOwnProperty(propertyName)) {
            return false;
        }

        const hvacValue = updatedProperties[propertyName];
        const capabilityValue = this.getCapabilityValue(capabilityName);

        // If HVAC and Homey have different values then it was changed
        return hvacValue !== capabilityValue;
    }

    /**
     * Special checks for power on/off check logic
     *
     * @param {Array} updatedProperties
     * @returns {boolean}
     * @private
     */
    _checkOnOffPowerPropertyChanged(updatedProperties) {
        if (!updatedProperties.hasOwnProperty(HVAC.PROPERTY.power)) {
            return false;
        }

        const propertyValue = updatedProperties[HVAC.PROPERTY.power];

        return this._checkBoolPropertyChanged(propertyValue, 'onoff', HVAC.VALUE.power.on);
    }

    /**
     * Check bool properties
     *
     * @param {string} propertyValue
     * @param {string} capabilityName
     * @param {string} trueValue
     * @returns {boolean}
     * @private
     */
    _checkBoolPropertyChanged(propertyValue, capabilityName, trueValue) {
        const capabilityValue = this.getCapabilityValue(capabilityName);

        const changedFromTrueToFalse = capabilityValue && propertyValue !== trueValue;
        const changedFromFalseToTrue = !capabilityValue && propertyValue === trueValue;

        return changedFromFalseToTrue || changedFromTrueToFalse;
    }
}

module.exports = GreeHVACDevice;
