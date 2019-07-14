'use strict';

const Homey = require('homey');
const finder = require('./network/finder');
const HVAC = require('gree-hvac-client');

class MyDevice extends Homey.Device {

    onInit() {
        this.log('MyDevice has been inited');
        finder.hvacs.forEach((hvac) => {
            const deviceData = this.getData();
            if (hvac.message.mac !== deviceData.mac) {
                // Skip other HVACs from the finder until find current
                return;
            }

            this.client = new HVAC.Client({host: hvac.remoteInfo.address, pollingInterval: 10});

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
                this.log('[HVAC mode change]', 'Value: ' + value, 'Raw value: ' + rawValue);
                this.client.setProperty(HVAC.PROPERTY.mode, rawValue)
            });

            this.client.on('connect', (client) => {
                this.log('connected to', client.getDeviceId());
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
                }

                if (updatedProperties.hasOwnProperty(HVAC.PROPERTY.temperature)) {
                    const value = updatedProperties[HVAC.PROPERTY.temperature];
                    this.setCapabilityValue('target_temperature', value).catch(this.log);
                }

                if (updatedProperties.hasOwnProperty(HVAC.PROPERTY.mode)) {
                    const value = updatedProperties[HVAC.PROPERTY.mode];
                    this.setCapabilityValue('hvac_mode', value).catch(this.log);
                }
            });
        });
    }

}

module.exports = MyDevice;