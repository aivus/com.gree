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
    }

}

function onoffToBoolean(value) {
    return value === 'on';
}

module.exports = GreeHVAC;
