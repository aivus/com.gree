'use strict';

const Homey = require('homey');
const finder = require('./network/finder');

class GreeHVACDriver extends Homey.Driver {

    async onInit() {
        this.log('GreeHVACDriver has been inited');
        this._finder = finder;
    }

    async onPairListDevices() {
        const devices = this._finder.hvacs.map(GreeHVACDriver.hvacToDevice);

        // // Test device for debugging without connected HVAC
        // devices.push({
        //     name: 'test',
        //     data: {
        //         id: 'test',
        //         mac: 'test',
        //     },
        // });

        return devices;
    }

    static hvacToDevice(hvac) {
        const { message, remoteInfo } = hvac;

        const name = `${message.name} (${remoteInfo.address})`;

        return {
            name,
            data: {
                id: message.cid,
                mac: message.mac,
                // test: 'test',
            },
        };
    }

}

module.exports = GreeHVACDriver;
