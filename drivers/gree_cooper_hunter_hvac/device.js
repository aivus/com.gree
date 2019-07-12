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
                const deviceValue = value ? HVAC.VALUE.power.on : HVAC.VALUE.power.off;
                this.client.setProperty(HVAC.PROPERTY.power, deviceValue)
            });

            this.registerCapabilityListener('target_temperature', async (value) => {
                this.client.setProperty(HVAC.PROPERTY.temperature, value)
            });



            this.client.on('connect', (client) => {
                console.log('connected to', client.getDeviceId());
            });

            this.client.on('update', (updatedProperties, properties) => {
                console.log(updatedProperties, properties);

                if (updatedProperties.hasOwnProperty(HVAC.PROPERTY.power)) {
                    const value = updatedProperties[HVAC.PROPERTY.power] === 'on';
                    this.setCapabilityValue('onoff', value).catch(console.log);
                }
                if (updatedProperties.hasOwnProperty(HVAC.PROPERTY.temperature)) {
                    const value = updatedProperties[HVAC.PROPERTY.temperature];
                    this.setCapabilityValue('target_temperature', value).catch(console.log);
                }
            });
        });
    }

}

module.exports = MyDevice;