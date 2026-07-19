'use strict';

describe('GreeHVACDevice sleep_mode listener', () => {
    let GreeHVACDevice;
    let device;
    let capabilityListeners;

    beforeEach(() => {
        jest.resetModules();

        capabilityListeners = {};

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));

        jest.doMock('gree-hvac-client', () => ({
            PROPERTY: { sleep: 'sleep' },
            VALUE: {
                sleep: {
                    off: 'off',
                    on: 'on',
                },
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
        device._setClientProperty = jest.fn().mockReturnValue(true);
        device._flowTriggerSleepModeChanged = {
            trigger: jest.fn(),
        };
        device.log = jest.fn();
    });

    test('turns sleep mode on', async () => {
        device._registerCapabilityListeners();

        await capabilityListeners.sleep_mode(true);

        expect(device._setClientProperty).toHaveBeenCalledWith('sleep', 'on');
        expect(device._flowTriggerSleepModeChanged.trigger).toHaveBeenCalledWith(device, { sleep_mode: true });
    });

    test('turns sleep mode off', async () => {
        device._registerCapabilityListeners();

        await capabilityListeners.sleep_mode(false);

        expect(device._setClientProperty).toHaveBeenCalledWith('sleep', 'off');
        expect(device._flowTriggerSleepModeChanged.trigger).toHaveBeenCalledWith(device, { sleep_mode: false });
    });

    test('rejects and does not trigger the flow when the command fails', async () => {
        device._setClientProperty.mockRejectedValue(new Error('error.not_connected'));
        device._registerCapabilityListeners();

        await expect(capabilityListeners.sleep_mode(true)).rejects.toThrow('error.not_connected');

        expect(device._flowTriggerSleepModeChanged.trigger).not.toHaveBeenCalled();
    });
});
