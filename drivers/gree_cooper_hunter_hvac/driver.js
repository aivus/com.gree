const Homey = require('homey');
const finder = require('./network/finder');

class GreeHVACDriver extends Homey.Driver {

    onInit() {
        this.log('GreeHVACDriver has been inited');
        this._finder = finder;
    }

    onPairListDevices(data, callback) {
        const devices = this._finder.hvacs.map(this._hvacToDevice);

        // // Test device for debugging without connected HVAC
        // devices.push({
        //     name: 'test',
        //     data: {
        //         id: 'test',
        //         mac: 'test',
        //     }
        // });

        callback(null, devices);
    }

    _hvacToDevice(hvac) {
        const { message, remoteInfo } = hvac;

        const name = `${message.name} (${remoteInfo.address})`;

        return {
            name,
            data: {
                id: message.cid,
                mac: message.mac
            }
        };
    }

}

module.exports = GreeHVACDriver;
