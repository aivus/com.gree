'use strict';

const Homey = require('homey');
const finder = require('./network/finder');

class GreeHVACDriver extends Homey.Driver {

  onInit() {
    this.log('GreeHVACDriver has been initialized');
    this._finder = finder;
  }

  onPairListDevices(data, callback) {
    const devices = this._finder.hvacs.map(GreeHVACDriver.hvacToDevice);

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
