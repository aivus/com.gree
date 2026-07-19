'use strict';

describe('GreeHVAC app flow action cards', () => {
    let GreeHVAC;
    let app;
    let runListeners;

    function makeCard(id) {
        return {
            registerRunListener: jest.fn((listener) => {
                runListeners[id] = listener;
            }),
        };
    }

    beforeEach(async () => {
        jest.resetModules();

        runListeners = {};

        jest.doMock('homey', () => ({
            App: class App {
                log() {}
                error() {}
            },
            manifest: { version: '0.0.0-test' },
        }));

        jest.doMock('homey-log', () => ({
            Log: jest.fn().mockImplementation(() => ({ captureMessage: jest.fn().mockResolvedValue() })),
        }));

        GreeHVAC = require('../app');

        app = new GreeHVAC();
        app.log = jest.fn();
        app.error = jest.fn();
        app.homey = {
            flow: {
                getConditionCard: jest.fn((id) => makeCard(id)),
                getActionCard: jest.fn((id) => makeCard(id)),
                getDeviceTriggerCard: jest.fn((id) => makeCard(id)),
            },
            notifications: { createNotification: jest.fn().mockResolvedValue() },
            __: jest.fn((key) => key),
        };

        await app.onInit();
    });

    test('sends the command before writing the capability value on success', async () => {
        const calls = [];
        const device = {
            triggerCapabilityListener: jest.fn(() => {
                calls.push('trigger');
                return Promise.resolve();
            }),
            setCapabilityValue: jest.fn(() => {
                calls.push('set');
                return Promise.resolve();
            }),
        };

        await runListeners.set_fan_speed({ device, speed: 'low' }, {});

        expect(device.triggerCapabilityListener).toHaveBeenCalledWith('fan_speed', 'low', {});
        expect(device.setCapabilityValue).toHaveBeenCalledWith('fan_speed', 'low');
        // The HVAC command must be attempted before the capability is written,
        // so a failed command leaves the capability untouched.
        expect(calls).toEqual(['trigger', 'set']);
    });

    test('rejects and does not write the capability value when the command fails', async () => {
        const device = {
            triggerCapabilityListener: jest.fn().mockRejectedValue(new Error('error.not_connected')),
            setCapabilityValue: jest.fn().mockResolvedValue(),
        };

        await expect(runListeners.set_fan_speed({ device, speed: 'low' }, {}))
            .rejects.toThrow('error.not_connected');

        expect(device.triggerCapabilityListener).toHaveBeenCalledWith('fan_speed', 'low', {});
        // The command failed, so the capability must not be set to the new value.
        expect(device.setCapabilityValue).not.toHaveBeenCalled();
    });
});
