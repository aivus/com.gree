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
        device.homey = { __: jest.fn((key) => key) };
        device.log = jest.fn();
        device.error = jest.fn();

        device._registerCapabilityListeners();
    });

    describe('when the client is not connected', () => {
        beforeEach(() => {
            device._client = null;
        });

        test('turning on rejects so Homey reverts the capability', async () => {
            await expect(capabilityListeners.onoff(true)).rejects.toThrow('error.not_connected');

            // The command was not delivered, so no secondary state is written
            expect(device.setCapabilityValue).not.toHaveBeenCalled();
        });

        test('turning off rejects and does not write thermostat_mode', async () => {
            await expect(capabilityListeners.onoff(false)).rejects.toThrow('error.not_connected');

            expect(device.setCapabilityValue).not.toHaveBeenCalled();
        });

        test('changing thermostat_mode rejects', async () => {
            await expect(capabilityListeners.thermostat_mode('cool')).rejects.toThrow('error.not_connected');

            expect(device.setCapabilityValue).not.toHaveBeenCalled();
        });
    });

    describe('when the client is connected', () => {
        beforeEach(() => {
            device._client = {
                setProperty: jest.fn().mockResolvedValue(),
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

    describe('when the client socket is gone but the client still exists', () => {
        let unhandledRejection;

        beforeEach(() => {
            unhandledRejection = jest.fn();
            process.on('unhandledRejection', unhandledRejection);

            device._client = {
                setProperty: jest.fn().mockRejectedValue(new Error('Client is not connected to the HVAC')),
                _properties: {},
                _transformer: {
                    fromVendor: jest.fn(() => ({})),
                },
            };
        });

        afterEach(() => {
            process.removeListener('unhandledRejection', unhandledRejection);
        });

        test('turning on rejects (so Homey reverts) without an unhandled rejection', async () => {
            await expect(capabilityListeners.onoff(true)).rejects.toThrow('error.not_connected');

            expect(device._client.setProperty).toHaveBeenCalledWith('power', 'on');
            // The command failed, so thermostat_mode must not be written optimistically
            expect(device.setCapabilityValue).not.toHaveBeenCalled();

            // Let any pending microtasks settle and confirm nothing escaped unhandled.
            await Promise.resolve();
            expect(unhandledRejection).not.toHaveBeenCalled();
        });
    });
});
