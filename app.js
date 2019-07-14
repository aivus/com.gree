'use strict';

const Homey = require('homey');

class MyApp extends Homey.App {

    onInit() {
        this.log('Gree HVAC control app is up and running...');
    }

}

module.exports = MyApp;
