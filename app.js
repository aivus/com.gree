'use strict';

const Homey = require('homey');
// eslint-disable-next-line no-unused-vars
const { Log } = require('homey-log');

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

        this._conditionTurboModeIs = new Homey.FlowCardCondition('turbo_mode_is')
            .register()
            .registerRunListener((args, state) => {
                const turboMode = args.device.getCapabilityValue('turbo_mode');
                args.device.log('[condition]', '[current turbo mode]', turboMode);
                return onoffToBoolean(args.mode) === turboMode;
            });

        this._conditionLightsIs = new Homey.FlowCardCondition('lights_is')
            .register()
            .registerRunListener((args, state) => {
                const lightsMode = args.device.getCapabilityValue('lights');
                args.device.log('[condition]', '[current lights]', lightsMode);
                return onoffToBoolean(args.mode) === lightsMode;
            });

        this._conditionXFanModeIs = new Homey.FlowCardCondition('xfan_mode_is')
            .register()
            .registerRunListener((args, state) => {
                const xfanMode = args.device.getCapabilityValue('xfan_mode');
                args.device.log('[condition]', '[current xfan mode]', xfanMode);
                return onoffToBoolean(args.mode) === xfanMode;
            });

        this._conditionVerticalSwingIs = new Homey.FlowCardCondition('vertical_swing_is')
            .register()
            .registerRunListener((args, state) => {
                const verticalSwing = args.device.getCapabilityValue('vertical_swing');
                args.device.log('[condition]', '[current swing vertical]', verticalSwing);
                return args.vertical_swing === verticalSwing;
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

        this._actionChangeTurboMode = new Homey.FlowCardAction('set_turbo_mode')
            .register()
            .registerRunListener((args, state) => {
                return args.device.setCapabilityValue('turbo_mode', onoffToBoolean(args.mode)).then(() => {
                    return args.device.triggerCapabilityListener('turbo_mode', onoffToBoolean(args.mode), {});
                });
            });

        this._actionChangeLights = new Homey.FlowCardAction('set_lights')
            .register()
            .registerRunListener((args, state) => {
                return args.device.setCapabilityValue('lights', onoffToBoolean(args.mode)).then(() => {
                    return args.device.triggerCapabilityListener('lights', onoffToBoolean(args.mode), {});
                });
            });

        this._actionChangeXFanMode = new Homey.FlowCardAction('set_xfan_mode')
            .register()
            .registerRunListener((args, state) => {
                return args.device.setCapabilityValue('xfan_mode', onoffToBoolean(args.mode)).then(() => {
                    return args.device.triggerCapabilityListener('xfan_mode', onoffToBoolean(args.mode), {});
                });
            });

        this._actionChangeVerticalSwing = new Homey.FlowCardAction('set_vertical_swing')
            .register()
            .registerRunListener((args, state) => {
                return args.device.setCapabilityValue('vertical_swing', args.vertical_swing).then(() => {
                    return args.device.triggerCapabilityListener('vertical_swing', args.vertical_swing, {});
                });
            });
    }

}

function onoffToBoolean(value) {
    return value === 'on';
}

module.exports = GreeHVAC;
