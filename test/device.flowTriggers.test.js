'use strict';

describe('GreeHVACDevice flow triggers from capability listeners', () => {
    let GreeHVACDevice;
    let device;
    let capabilityListeners;

    beforeEach(() => {
        jest.resetModules();

        capabilityListeners = {};

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));

        jest.doMock('gree-hvac-client', () => ({
            PROPERTY: { fanSpeed: 'fanSpeed', turbo: 'turbo' },
            VALUE: {
                fanSpeed: { low: 'low', high: 'high' },
                turbo: { on: 'on', off: 'off' },
            },
        }));

        jest.doMock('homey', () => ({
            Device: class Device {
                log() {}
                error() {}
            },
        }));

        GreeHVACDevice = require('../drivers/gree_cooper_hunter_hvac/device');

        device = new GreeHVACDevice();
        device.registerCapabilityListener = jest.fn((capability, listener) => {
            capabilityListeners[capability] = listener;
        });
        device.log = jest.fn();
        device.homey = { __: jest.fn((key) => key) };
        device._flowTriggerHvacFanSpeedChanged = { trigger: jest.fn() };
        device._flowTriggerTurboModeChanged = { trigger: jest.fn() };

        device._registerCapabilityListeners();
    });

    test('fires the trigger when the command is sent to the HVAC', async () => {
        device._client = { setProperty: jest.fn().mockResolvedValue() };

        await capabilityListeners.fan_speed('low');

        expect(device._client.setProperty).toHaveBeenCalledWith('fanSpeed', 'low');
        expect(device._flowTriggerHvacFanSpeedChanged.trigger)
            .toHaveBeenCalledWith(device, { fan_speed: 'low' });
    });

    test('rejects and does not fire the trigger when the client is not connected', async () => {
        device._client = null;

        await expect(capabilityListeners.fan_speed('low')).rejects.toThrow('error.not_connected');
        await expect(capabilityListeners.turbo_mode(true)).rejects.toThrow('error.not_connected');

        expect(device._flowTriggerHvacFanSpeedChanged.trigger).not.toHaveBeenCalled();
        expect(device._flowTriggerTurboModeChanged.trigger).not.toHaveBeenCalled();
    });

    test('rejects an unknown fan speed value without sending the command or firing the trigger', async () => {
        device._client = { setProperty: jest.fn().mockResolvedValue() };

        await expect(capabilityListeners.fan_speed(null))
            .rejects.toThrow('Unknown fan speed value: null');

        expect(device._client.setProperty).not.toHaveBeenCalled();
        expect(device._flowTriggerHvacFanSpeedChanged.trigger).not.toHaveBeenCalled();
    });
});
