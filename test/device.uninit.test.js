'use strict';

describe('GreeHVACDevice cleanup on removal and app shutdown', () => {
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
        device.homey = {
            clearInterval: jest.fn((ref) => clearInterval(ref)),
            clearTimeout: jest.fn((ref) => clearTimeout(ref)),
        };
    });

    function setupResources() {
        const client = {
            removeAllListeners: jest.fn(),
            disconnect: jest.fn().mockResolvedValue(),
        };
        device._client = client;
        device._lookingForDeviceIntervalRef = setInterval(() => {}, 1000);
        device._noResponseReconnectTimeoutRef = setTimeout(() => {}, 1000);
        return client;
    }

    afterEach(() => {
        if (device._lookingForDeviceIntervalRef) {
            clearInterval(device._lookingForDeviceIntervalRef);
        }
        if (device._noResponseReconnectTimeoutRef) {
            clearTimeout(device._noResponseReconnectTimeoutRef);
        }
    });

    test('onUninit stops timers and disconnects the client', async () => {
        const client = setupResources();

        await device.onUninit();

        expect(device._lookingForDeviceIntervalRef).toBeNull();
        expect(device._noResponseReconnectTimeoutRef).toBeNull();
        expect(client.removeAllListeners).toHaveBeenCalled();
        expect(client.disconnect).toHaveBeenCalled();
        expect(device._client).toBeNull();
    });

    test('onDeleted stops timers and disconnects the client', () => {
        const client = setupResources();

        device.onDeleted();

        expect(device._lookingForDeviceIntervalRef).toBeNull();
        expect(device._noResponseReconnectTimeoutRef).toBeNull();
        expect(client.removeAllListeners).toHaveBeenCalled();
        expect(client.disconnect).toHaveBeenCalled();
        expect(device._client).toBeNull();
    });

    test('onUninit is safe when nothing was ever started', async () => {
        await expect(device.onUninit()).resolves.toBeUndefined();
    });
});
