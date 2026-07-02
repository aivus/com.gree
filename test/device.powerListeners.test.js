'use strict';

describe('GreeHVACDevice onoff/thermostat_mode listeners', () => {
    let GreeHVACDevice;
    let device;
    let capabilityListeners;

    beforeEach(() => {
        jest.resetModules();

        capabilityListeners = {};

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));

        jest.doMock('gree-hvac-client', () => ({
            PROPERTY: { power: 'power', mode: 'mode', temperature: 'temperature' },
            VALUE: {
                power: { on: 'on', off: 'off' },
                mode: { auto: 'auto', cool: 'cool', heat: 'heat' },
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
        device.setCapabilityValue = jest.fn().mockResolvedValue();
        device.log = jest.fn();
        device.error = jest.fn();

        device._registerCapabilityListeners();
    });

    describe('when the client is not connected', () => {
        beforeEach(() => {
            device._client = null;
        });

        test('turning on does not throw', async () => {
            await expect(capabilityListeners.onoff(true)).resolves.toBeUndefined();

            // No known mode to restore, so thermostat_mode should stay untouched
            expect(device.setCapabilityValue).not.toHaveBeenCalledWith('thermostat_mode', expect.anything());
        });

        test('turning off does not throw and sets thermostat_mode to off', async () => {
            await expect(capabilityListeners.onoff(false)).resolves.toBeUndefined();

            expect(device.setCapabilityValue).toHaveBeenCalledWith('thermostat_mode', 'off');
        });

        test('changing thermostat_mode does not throw', async () => {
            await expect(capabilityListeners.thermostat_mode('cool')).resolves.toBeUndefined();
        });
    });

    describe('when the client is connected', () => {
        beforeEach(() => {
            device._client = {
                setProperty: jest.fn(),
                _properties: { Pow: 0, Mod: 1 },
                _transformer: {
                    fromVendor: jest.fn(() => ({ power: 'off', mode: 'cool' })),
                },
            };
        });

        test('turning on restores thermostat_mode from the client state', async () => {
            await capabilityListeners.onoff(true);

            expect(device._client.setProperty).toHaveBeenCalledWith('power', 'on');
            expect(device.setCapabilityValue).toHaveBeenCalledWith('thermostat_mode', 'cool');
        });

        test('changing thermostat_mode turns the HVAC on when it is off', async () => {
            await capabilityListeners.thermostat_mode('heat');

            expect(device._client.setProperty).toHaveBeenCalledWith('mode', 'heat');
            expect(device._client.setProperty).toHaveBeenCalledWith('power', 'on');
            expect(device.setCapabilityValue).toHaveBeenCalledWith('onoff', true);
        });
    });
});
