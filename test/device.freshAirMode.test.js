'use strict';

describe('GreeHVACDevice fresh_air_mode listener', () => {
    let GreeHVACDevice;
    let device;
    let capabilityListeners;

    beforeEach(() => {
        jest.resetModules();

        capabilityListeners = {};

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));

        jest.doMock('gree-hvac-client', () => ({
            PROPERTY: { air: 'air' },
            VALUE: {
                air: {
                    off: 'off',
                    inside: 'inside',
                    outside: 'outside',
                    mode3: 'mode3',
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
        device._flowTriggerFreshAirModeChanged = {
            trigger: jest.fn(),
        };
        device.log = jest.fn();
    });

    test('sets fresh air mode to outside', async () => {
        device._registerCapabilityListeners();

        await capabilityListeners.fresh_air_mode('outside');

        expect(device._setClientProperty).toHaveBeenCalledWith('air', 'outside');
        expect(device._flowTriggerFreshAirModeChanged.trigger).toHaveBeenCalledWith(device, { fresh_air_mode: 'outside' });
    });

    test('turns fresh air mode off', async () => {
        device._registerCapabilityListeners();

        await capabilityListeners.fresh_air_mode('off');

        expect(device._setClientProperty).toHaveBeenCalledWith('air', 'off');
        expect(device._flowTriggerFreshAirModeChanged.trigger).toHaveBeenCalledWith(device, { fresh_air_mode: 'off' });
    });

    test('rejects unknown fresh air mode values', async () => {
        device._registerCapabilityListeners();

        await expect(capabilityListeners.fresh_air_mode(null))
            .rejects.toThrow('Unknown fresh air mode value: null');

        expect(device._setClientProperty).not.toHaveBeenCalled();
        expect(device._flowTriggerFreshAirModeChanged.trigger).not.toHaveBeenCalled();
    });
});
