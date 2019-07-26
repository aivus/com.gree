'use strict';

const Homey = require('homey');

class GreeHVAC extends Homey.App {

    onInit() {
        this.log('Gree HVAC app is up and running...');

        // Register conditions for flows
        this._conditionHVACModeIs = new Homey.FlowCardCondition('hvac_mode_is')
            .register()
            .registerRunListener((args, state) => {
                return args.mode === args.device.getCapabilityValue('hvac_mode');
            });

        this._conditionFanSpeedIs = new Homey.FlowCardCondition('fan_speed_is')
            .register()
            .registerRunListener((args, state) => {
                return args.speed === args.device.getCapabilityValue('fan_speed');
            });
    }
}

module.exports = GreeHVAC;
