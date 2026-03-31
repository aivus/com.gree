'use strict';

describe('GreeHVACDevice._findDevices()', () => {
    let GreeHVACDevice;
    let mockFinder;
    let device;

    beforeEach(() => {
        jest.resetModules();

        mockFinder = { hvacs: [] };

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => mockFinder);

        jest.doMock('gree-hvac-client', () => ({
            Client: jest.fn().mockImplementation(() => ({})),
            PROPERTY: { power: 'power', mode: 'mode', temperature: 'temperature' },
            VALUE: { power: { on: 'on', off: 'off' } },
        }));

        jest.doMock('homey', () => ({
            Device: class Device {
                log() {}
                error() {}
            },
        }));

        GreeHVACDevice = require('../drivers/gree_cooper_hunter_hvac/device');

        device = new GreeHVACDevice();
        device._client = null;
        device.getData = jest.fn(() => ({ id: 'aabb', mac: 'aabb' }));
        device.getSetting = jest.fn(() => '');
        device.log = jest.fn();
        device._stopLookingForDevice = jest.fn();
        device._connectToHost = jest.fn();
    });

    test('returns immediately if client already connected', () => {
        device._client = {};

        device._findDevices();

        expect(device._stopLookingForDevice).not.toHaveBeenCalled();
        expect(device._connectToHost).not.toHaveBeenCalled();
    });

    test('connects via static IP when setting is set', () => {
        device.getSetting = jest.fn(() => '192.168.1.50');

        device._findDevices();

        expect(device._stopLookingForDevice).toHaveBeenCalled();
        expect(device._connectToHost).toHaveBeenCalledWith('192.168.1.50');
    });

    test('does not use finder when static IP is set', () => {
        device.getSetting = jest.fn(() => '192.168.1.50');
        mockFinder.hvacs = [
            { message: { mac: 'aabb' }, remoteInfo: { address: '10.0.0.1' } },
        ];

        device._findDevices();

        // Should connect to static IP, not to finder's address
        expect(device._connectToHost).toHaveBeenCalledWith('192.168.1.50');
        expect(device._connectToHost).not.toHaveBeenCalledWith('10.0.0.1');
    });

    test('uses finder when static IP setting is empty', () => {
        device.getSetting = jest.fn(() => '');
        mockFinder.hvacs = [
            { message: { mac: 'aabb' }, remoteInfo: { address: '10.0.0.5' } },
        ];

        device._findDevices();

        expect(device._connectToHost).toHaveBeenCalledWith('10.0.0.5');
        expect(device._stopLookingForDevice).toHaveBeenCalled();
    });

    test('skips HVACs from finder that do not match device MAC', () => {
        device.getSetting = jest.fn(() => '');
        mockFinder.hvacs = [
            { message: { mac: 'different-mac' }, remoteInfo: { address: '10.0.0.9' } },
        ];

        device._findDevices();

        expect(device._connectToHost).not.toHaveBeenCalled();
    });

    test('connects to matching finder HVAC by MAC', () => {
        device.getSetting = jest.fn(() => '');
        mockFinder.hvacs = [
            { message: { mac: 'wrong-mac' }, remoteInfo: { address: '10.0.0.1' } },
            { message: { mac: 'aabb' }, remoteInfo: { address: '10.0.0.2' } },
        ];

        device._findDevices();

        expect(device._connectToHost).toHaveBeenCalledTimes(1);
        expect(device._connectToHost).toHaveBeenCalledWith('10.0.0.2');
    });
});
