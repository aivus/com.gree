'use strict';

describe('GreeHVACDevice._tryToDisconnect()', () => {
    let GreeHVACDevice;
    let device;

    beforeEach(() => {
        jest.resetModules();

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));

        jest.doMock('gree-hvac-client', () => ({
            PROPERTY: {},
            VALUE: {},
        }));

        jest.doMock('homey', () => ({
            Device: class Device {
                log() {}
                error() {}
            },
        }));

        GreeHVACDevice = require('../drivers/gree_cooper_hunter_hvac/device');

        device = new GreeHVACDevice();
        device.log = jest.fn();
        device.error = jest.fn();
    });

    test('handles disconnect() rejection instead of leaving it unhandled', async () => {
        const rejection = new Error('Client is not connected to the HVAC');
        device._client = {
            removeAllListeners: jest.fn(),
            disconnect: jest.fn().mockRejectedValue(rejection),
        };

        device._tryToDisconnect();

        expect(device._client).toBeNull();

        // Flush microtasks so the rejection is delivered
        await new Promise((resolve) => process.nextTick(resolve));

        expect(device.error).toHaveBeenCalledWith(rejection);
    });

    test('removes listeners before disconnecting and clears the client', () => {
        const client = {
            removeAllListeners: jest.fn(),
            disconnect: jest.fn().mockResolvedValue(),
        };
        device._client = client;

        device._tryToDisconnect();

        expect(client.removeAllListeners).toHaveBeenCalled();
        expect(client.disconnect).toHaveBeenCalled();
        expect(device._client).toBeNull();
    });

    test('does nothing when there is no client', () => {
        device._client = null;

        expect(() => device._tryToDisconnect()).not.toThrow();
    });
});
