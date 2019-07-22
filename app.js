'use strict';

const Homey = require('homey');

class GreeHVAC extends Homey.App {

    onInit() {
        this.log('Gree HVAC app is up and running...');
    }
}

module.exports = GreeHVAC;
