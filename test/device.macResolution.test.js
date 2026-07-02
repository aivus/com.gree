'use strict';

describe('GreeHVACDevice MAC resolution for "Skip UDP scan" devices', () => {
    let GreeHVACDevice;
    let mockFinder;
    let device;

    beforeEach(() => {
        jest.resetModules();

        mockFinder = { hvacs: [] };

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => mockFinder);

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
        device.getData = jest.fn(() => ({ id: '192.168.1.50', mac: '192.168.1.50' }));
        device.getStoreValue = jest.fn(() => null);
        device.setStoreValue = jest.fn().mockResolvedValue();
        device.setAvailable = jest.fn();
        device._cancelNoResponseReconnect = jest.fn();
    });

    describe('getMac()', () => {
        test('falls back to device data when no MAC is stored', () => {
            expect(device.getMac()).toBe('192.168.1.50');
        });

        test('prefers the resolved MAC from the store', () => {
            device.getStoreValue = jest.fn(() => 'aabbccddeeff');

            expect(device.getMac()).toBe('aabbccddeeff');
            expect(device.getStoreValue).toHaveBeenCalledWith('mac');
        });
    });

    describe('_onConnect()', () => {
        test('stores the real MAC when it differs from device data', () => {
            const client = { getDeviceId: jest.fn(() => 'aabbccddeeff') };

            device._onConnect(client);

            expect(device.setStoreValue).toHaveBeenCalledWith('mac', 'aabbccddeeff');
        });

        test('does not touch the store when the MAC is already known', () => {
            device.getData = jest.fn(() => ({ id: 'aabbccddeeff', mac: 'aabbccddeeff' }));
            const client = { getDeviceId: jest.fn(() => 'aabbccddeeff') };

            device._onConnect(client);

            expect(device.setStoreValue).not.toHaveBeenCalled();
        });

        test('ignores an empty device id from the client', () => {
            const client = { getDeviceId: jest.fn(() => null) };

            device._onConnect(client);

            expect(device.setStoreValue).not.toHaveBeenCalled();
        });
    });

    describe('_findDevices()', () => {
        test('matches finder results against the resolved MAC', () => {
            device.getStoreValue = jest.fn(() => 'aabbccddeeff');
            device.getSetting = jest.fn(() => '');
            device._stopLookingForDevice = jest.fn();
            device._connectToHost = jest.fn();
            mockFinder.hvacs = [
                { message: { mac: 'aabbccddeeff' }, remoteInfo: { address: '10.0.0.7' } },
            ];

            device._findDevices();

            expect(device._connectToHost).toHaveBeenCalledWith('10.0.0.7');
        });
    });
});
