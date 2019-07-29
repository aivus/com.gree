'use strict';

const Homey = require('homey');

class GreeHVAC extends Homey.App {

    onInit() {
        this.log('Gree HVAC app is up and running...');

        // Register conditions for flows
        this._conditionHVACModeIs = new Homey.FlowCardCondition('hvac_mode_is')
            .register()
            .registerRunListener((args, state) => {
                const hvacMode = args.device.getCapabilityValue('hvac_mode');
                args.device.log('[condition]', '[current hvac mode]', hvacMode);
                return args.mode === hvacMode;
            });

        this._conditionFanSpeedIs = new Homey.FlowCardCondition('fan_speed_is')
            .register()
            .registerRunListener((args, state) => {
                const fanSpeed = args.device.getCapabilityValue('fan_speed');
                args.device.log('[condition]', '[current fan speed]', fanSpeed);
                return args.speed === fanSpeed;
            });

        // Register actions for flows
        this._actionChangeHVACMode = new Homey.FlowCardAction('set_hvac_mode')
            .register()
            .registerRunListener((args, state) => {
                return args.device.setCapabilityValue('hvac_mode', args.mode).then(() => {
                    return args.device.triggerCapabilityListener('hvac_mode', args.mode, {});
                });
            });

        this._actionChangeFanSpeed = new Homey.FlowCardAction('set_fan_speed')
            .register()
            .registerRunListener((args, state) => {
                return args.device.setCapabilityValue('fan_speed', args.speed).then(() => {
                    return args.device.triggerCapabilityListener('fan_speed', args.speed, {});
                });
            });
    }
}

module.exports = GreeHVAC;
