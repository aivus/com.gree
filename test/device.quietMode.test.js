'use strict';

describe('GreeHVACDevice quiet_mode listener', () => {
    let GreeHVACDevice;
    let device;
    let capabilityListeners;

    beforeEach(() => {
        jest.resetModules();

        capabilityListeners = {};

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));

        jest.doMock('gree-hvac-client', () => ({
            PROPERTY: { quiet: 'quiet' },
            VALUE: {
                quiet: {
                    off: 'off',
                    mode1: 'mode1',
                    mode2: 'mode2',
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
        device._setClientProperty = jest.fn();
        device._flowTriggerQuietModeChanged = {
            trigger: jest.fn(),
        };
        device.log = jest.fn();
    });

    test('skips null quiet mode values', async () => {
        device._registerCapabilityListeners();

        await capabilityListeners.quiet_mode(null);

        expect(device.log).toHaveBeenCalledWith('[quiet mode change]', 'Skip null value');
        expect(device._setClientProperty).not.toHaveBeenCalled();
        expect(device._flowTriggerQuietModeChanged.trigger).not.toHaveBeenCalled();
    });
});
