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

class GreeHVACDevice extends Homey.Device {
    onInit() {
        this.log('Gree device has been inited');

        this._markOffline();
        this._findDevices();
        this._reconnectInterval = setInterval(() => {
            this._findDevices();
        }, RECONNECT_TIME_INTERVAL);
    }

    onDeleted() {
        if (this.client) {
            this.client.disconnect();
            this.client.removeAllListeners();
            delete this.client;
        }

        if (this._reconnectInterval) {
            clearInterval(this._reconnectInterval);
            delete this._reconnectInterval;
        }

        this.log('Gree device has been deleted.');
    }

    _findDevices() {
        this.log('Trying to find devices');
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

            this.client.on('error', this._onError.bind(this));
            this.client.on('connect', this._onConnect.bind(this));
            this.client.on('update', this._onUpdate.bind(this));
            this.client.on('no_response', this._onNoResponse.bind(this));
            this.client.on('disconnect', this._onDisconnect.bind(this));

            this._registerCapabilities();
        });
    }

    _onConnect(client) {
        this.log('[connect]', 'connected to', client.getDeviceId());
        clearInterval(this._reconnectInterval);
        delete this._reconnectInterval;
        this.setAvailable();
    }

    /**
     * Responsible for updating Homey device data based on information from HVAC
     *
     * @param updatedProperties
     * @param properties
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

        if (updatedProperties.hasOwnProperty(HVAC.PROPERTY.power)) {
            const value = updatedProperties[HVAC.PROPERTY.power] === HVAC.VALUE.power.on;
            this.setCapabilityValue('onoff', value).catch(this.log);
            this.log('[update properties]', '[onoff]', value);
        }

        if (updatedProperties.hasOwnProperty(HVAC.PROPERTY.temperature)) {
            const value = updatedProperties[HVAC.PROPERTY.temperature];
            this.setCapabilityValue('target_temperature', value).catch(this.log);
            this.log('[update properties]', '[target_temperature]', value);
        }

        if (updatedProperties.hasOwnProperty(HVAC.PROPERTY.mode)) {
            const value = updatedProperties[HVAC.PROPERTY.mode];
            this.setCapabilityValue('hvac_mode', value).catch(this.log);
            this.log('[update properties]', '[hvac_mode]', value);
        }
    }

    _onError(message, error) {
        this.log('[ERROR]', 'Message:', message, 'Error', error);
        this._markOffline();
    }

    _onNoResponse(client) {
        this.log('[no response]', 'Don\'t get response during polling updates');
        this._markOffline();
    }

    _onDisconnect() {
        this.log('[disconnect]', 'Disconnected from HVAC');
        this._markOffline();
    }

    _markOffline() {
        this.setUnavailable(Homey.__('error.offline'));
        this.log('[offline] mark device offline');
    }

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
    }
}

module.exports = GreeHVACDevice;
