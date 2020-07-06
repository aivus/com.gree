'use strict';

const Homey = require('homey');
const finder = require('./network/finder');

class GreeHVACDriver extends Homey.Driver {

    onInit() {
        this.log('GreeHVACDriver has been inited');
        this._finder = finder;
    }

    onPair(socket) {
        socket.on('list_devices', (data, callback) => {
            const devices = this._finder.hvacs.map(GreeHVACDriver.hvacToDevice);

            if (devices.length === 0) {
                socket.showView('search_device');
            } else {
                callback(null, devices);
            }
        });

        socket.on('validate_data', (data, callback) => {
            // Show loading view while we validate the ip address
            socket.showView('loading');

            this._finder.scanSpecificAddress(data.ipAddress);

            socket.showView('list_devices');
        });
    }

    static hvacToDevice(hvac) {
        const { message, remoteInfo } = hvac;

        const name = `${message.name} (${remoteInfo.address})`;

        return {
            name,
            data: {
                id: message.cid,
                mac: message.mac,
                ipAddress: remoteInfo.address,
                // test: 'test',
            },
        };
    }

}

module.exports = GreeHVACDriver;
