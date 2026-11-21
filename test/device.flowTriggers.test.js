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
        device.setCapabilityValue = jest.fn().mockResolvedValue();
        device.homey = { __: jest.fn((key) => key) };
        device._flowTriggerHvacFanSpeedChanged = { trigger: jest.fn().mockResolvedValue() };
        device._flowTriggerTurboModeChanged = { trigger: jest.fn().mockResolvedValue() };

        device._registerCapabilityListeners();
    });

    test('fires the trigger when the command is sent to the HVAC', async () => {
        device._client = { setProperty: jest.fn().mockResolvedValue() };

        await capabilityListeners.fan_speed('low');

        expect(device._client.setProperty).toHaveBeenCalledWith('fanSpeed', 'low');
        expect(device._flowTriggerHvacFanSpeedChanged.trigger)
            .toHaveBeenCalledWith(device, { fan_speed: 'low' });
    });

    test('stores the new capability value before firing the trigger (#305)', async () => {
        device._client = { setProperty: jest.fn().mockResolvedValue() };

        await capabilityListeners.turbo_mode(true);

        expect(device.setCapabilityValue).toHaveBeenCalledWith('turbo_mode', true);
        expect(device._flowTriggerTurboModeChanged.trigger)
            .toHaveBeenCalledWith(device, { turbo_mode: true });
        expect(device.setCapabilityValue.mock.invocationCallOrder[0])
            .toBeLessThan(device._flowTriggerTurboModeChanged.trigger.mock.invocationCallOrder[0]);
    });

    test('does not fail the listener when the flow trigger rejects', async () => {
        device._client = { setProperty: jest.fn().mockResolvedValue() };
        device.error = jest.fn();
        const error = new Error('trigger failed');
        device._flowTriggerHvacFanSpeedChanged.trigger.mockRejectedValue(error);

        await expect(capabilityListeners.fan_speed('low')).resolves.toBeUndefined();
        await new Promise(setImmediate);

        expect(device.error).toHaveBeenCalledWith(error);
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
