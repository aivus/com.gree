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
        device.getStoreValue = jest.fn(() => null);
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

    test('reconnects when static IP setting changes', () => {
        device.reconnect = jest.fn();

        device.onSettings({
            oldSettings: { static_ip: '192.168.1.50' },
            newSettings: { static_ip: '192.168.1.51' },
            changedKeys: ['static_ip'],
        });

        expect(device.reconnect).toHaveBeenCalledTimes(1);
        expect(device.reconnect).toHaveBeenCalledWith();
        expect(device._pendingSettings.static_ip).toBe('192.168.1.51');
    });

    test('rejects an invalid static IP and does not reconnect', async () => {
        device.reconnect = jest.fn();
        device.homey = { __: jest.fn((key) => key) };

        await expect(device.onSettings({
            oldSettings: { static_ip: '' },
            newSettings: { static_ip: 'not-an-ip' },
            changedKeys: ['static_ip'],
        })).rejects.toThrow('error.invalid_static_ip');

        expect(device.reconnect).not.toHaveBeenCalled();
        expect(device._pendingSettings.static_ip).toBeUndefined();
    });

    test('applies the target temperature range when the minimum setting changes', async () => {
        device.reconnect = jest.fn();
        device.setCapabilityOptions = jest.fn(() => Promise.resolve());

        await device.onSettings({
            oldSettings: { min_target_temperature: 16 },
            newSettings: { min_target_temperature: 8 },
            changedKeys: ['min_target_temperature'],
        });

        expect(device.reconnect).not.toHaveBeenCalled();
        expect(device.setCapabilityOptions).toHaveBeenCalledWith('target_temperature', {
            min: 8,
            max: 30,
            step: 1,
        });
    });

    test('falls back to the default minimum target temperature when the setting is unset', async () => {
        device.getSetting = jest.fn(() => undefined);
        device.setCapabilityOptions = jest.fn(() => Promise.resolve());

        await device._applyTargetTemperatureRange();

        expect(device.setCapabilityOptions).toHaveBeenCalledWith('target_temperature', {
            min: 16,
            max: 30,
            step: 1,
        });
    });

    test('find devices trims whitespace around the static IP setting', () => {
        device.getSetting = jest.fn(() => '  192.168.1.50  ');

        device._findDevices();

        expect(device._connectToHost).toHaveBeenCalledWith('192.168.1.50');
    });

    test('does not reconnect when static IP setting value is unchanged', () => {
        device.reconnect = jest.fn();

        device.onSettings({
            oldSettings: { static_ip: '192.168.1.50' },
            newSettings: { static_ip: '192.168.1.50' },
            changedKeys: ['static_ip'],
        });

        expect(device.reconnect).not.toHaveBeenCalled();
    });

    test('does not reconnect when unrelated settings change', () => {
        device.reconnect = jest.fn();

        device.onSettings({
            oldSettings: { static_ip: '192.168.1.50' },
            newSettings: { static_ip: '192.168.1.50' },
            changedKeys: ['other_setting'],
        });

        expect(device.reconnect).not.toHaveBeenCalled();
    });

    test('reconnects with an empty static IP override when static IP setting is cleared', () => {
        device.reconnect = jest.fn();

        device.onSettings({
            oldSettings: { static_ip: '192.168.1.50' },
            newSettings: { static_ip: '' },
            changedKeys: ['static_ip'],
        });

        expect(device.reconnect).toHaveBeenCalledTimes(1);
        expect(device.reconnect).toHaveBeenCalledWith();
        expect(device._pendingSettings.static_ip).toBe('');
    });

    test('reconnect starts lookup', () => {
        device._markOffline = jest.fn();
        device._tryToDisconnect = jest.fn();
        device._startLookingForDevice = jest.fn();

        device.reconnect();

        expect(device._markOffline).toHaveBeenCalledTimes(1);
        expect(device._tryToDisconnect).toHaveBeenCalledTimes(1);
        expect(device._startLookingForDevice).toHaveBeenCalledTimes(1);
        expect(device._startLookingForDevice).toHaveBeenCalledWith();
    });

    test('find devices uses pending empty static IP setting instead of old stored setting', () => {
        device.getSetting = jest.fn(() => '192.168.1.50');
        device._pendingSettings.static_ip = '';
        mockFinder.hvacs = [
            { message: { mac: 'aabb' }, remoteInfo: { address: '10.0.0.5' } },
        ];

        device._findDevices();

        expect(device._connectToHost).toHaveBeenCalledWith('10.0.0.5');
        expect(device._connectToHost).not.toHaveBeenCalledWith('192.168.1.50');
    });
});
