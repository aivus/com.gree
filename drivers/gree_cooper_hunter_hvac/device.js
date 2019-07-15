'use strict';

const Homey = require('homey');
const finder = require('./network/finder');
const HVAC = require('gree-hvac-client');

// Interval between trying to found our device
const RECONNECT_TIME_INTERVAL = 10000;

// Interval between polling status from device
const POLLING_INTERVAL = 3000;

class MyDevice extends Homey.Device {
    onInit() {
        this.log('Gree, Cooper&Hunter device has been inited');
        this._markOffline();

        this._findDevices();
        this._reconnectInterval = setInterval( () => {
            this._findDevices();
        }, RECONNECT_TIME_INTERVAL);
    }

    _findDevices() {
        this.log('Trying to find devices');
        const deviceData = this.getData();

        finder.hvacs.forEach((hvac) => {
            if (hvac.message.mac !== deviceData.mac) {
                // Skip other HVACs from the finder until find current
                return;
            }

            this.client = new HVAC.Client({host: hvac.remoteInfo.address, pollingInterval: POLLING_INTERVAL});

            // TODO: Temporary check
            this.client._socket.on('error', (error) => {
                this.log('[Socket ERROR]', error);
            });

            this.client.on('error', (message, error) => {
                this.log('[ERROR]', 'Message:', message, 'Error', error);
                this._markOffline();
            });

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

            this.client.on('connect', (client) => {
                this.log('[connect]', 'connected to', client.getDeviceId());
                clearInterval(this._reconnectInterval);
                this.setAvailable();
            });

            this.client.on('update', (updatedProperties, properties) => {

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

                if (updatedProperties.hasOwnProperty(HVAC.PROPERTY.power)) {
                    const value = updatedProperties[HVAC.PROPERTY.power] === 'on';
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
            });
        });
    }

    _markOffline() {
        this.setUnavailable(Homey.__('error.offline'));
        this.log('[connect] offline');
    }
}

module.exports = MyDevice;
