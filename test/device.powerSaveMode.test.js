'use strict';

describe('GreeHVACDevice power_save_mode listener', () => {
    let GreeHVACDevice;
    let device;
    let capabilityListeners;

    beforeEach(() => {
        jest.resetModules();

        capabilityListeners = {};

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));

        jest.doMock('gree-hvac-client', () => ({
            PROPERTY: { powerSave: 'powerSave' },
            VALUE: {
                powerSave: {
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
        device._flowTriggerPowerSaveModeChanged = {
            trigger: jest.fn(),
        };
        device.log = jest.fn();
    });

    test('turns power save mode on', async () => {
        device._registerCapabilityListeners();

        await capabilityListeners.power_save_mode(true);

        expect(device._setClientProperty).toHaveBeenCalledWith('powerSave', 'on');
        expect(device._flowTriggerPowerSaveModeChanged.trigger).toHaveBeenCalledWith(device, { power_save_mode: true });
    });

    test('turns power save mode off', async () => {
        device._registerCapabilityListeners();

        await capabilityListeners.power_save_mode(false);

        expect(device._setClientProperty).toHaveBeenCalledWith('powerSave', 'off');
        expect(device._flowTriggerPowerSaveModeChanged.trigger).toHaveBeenCalledWith(device, { power_save_mode: false });
    });

    test('rejects and does not trigger the flow when the command fails', async () => {
        device._setClientProperty.mockRejectedValue(new Error('error.not_connected'));
        device._registerCapabilityListeners();

        await expect(capabilityListeners.power_save_mode(true)).rejects.toThrow('error.not_connected');

        expect(device._flowTriggerPowerSaveModeChanged.trigger).not.toHaveBeenCalled();
    });
});
