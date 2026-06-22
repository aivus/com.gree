'use strict';

describe('GreeHVACDevice health_mode listener', () => {
    let GreeHVACDevice;
    let device;
    let capabilityListeners;

    beforeEach(() => {
        jest.resetModules();

        capabilityListeners = {};

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));

        jest.doMock('gree-hvac-client', () => ({
            PROPERTY: { health: 'health' },
            VALUE: {
                health: {
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
        device._setClientProperty = jest.fn();
        device._flowTriggerHealthModeChanged = {
            trigger: jest.fn(),
        };
        device.log = jest.fn();
    });

    test('turns health mode on', async () => {
        device._registerCapabilityListeners();

        await capabilityListeners.health_mode(true);

        expect(device._setClientProperty).toHaveBeenCalledWith('health', 'on');
        expect(device._flowTriggerHealthModeChanged.trigger).toHaveBeenCalledWith(device, { health_mode: true });
    });

    test('turns health mode off', async () => {
        device._registerCapabilityListeners();

        await capabilityListeners.health_mode(false);

        expect(device._setClientProperty).toHaveBeenCalledWith('health', 'off');
        expect(device._flowTriggerHealthModeChanged.trigger).toHaveBeenCalledWith(device, { health_mode: false });
    });
});
