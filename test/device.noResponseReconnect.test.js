'use strict';

describe('GreeHVACDevice reconnect on prolonged no response', () => {
    let GreeHVACDevice;
    let device;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));

        jest.doMock('gree-hvac-client', () => ({
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
        device.homey = {
            setTimeout: (fn, ms) => setTimeout(fn, ms),
            clearTimeout: (ref) => clearTimeout(ref),
        };
        device.log = jest.fn();
        device.getAvailable = jest.fn(() => true);
        device.getSetting = jest.fn(() => undefined);
        device._markOffline = jest.fn();
        device.reconnect = jest.fn();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('reconnects when the HVAC keeps not responding', () => {
        device._onNoResponse();

        jest.advanceTimersByTime(60 * 1000);

        expect(device.reconnect).toHaveBeenCalledTimes(1);
    });

    test('schedules only one reconnect for consecutive no_response events', () => {
        device._onNoResponse();
        jest.advanceTimersByTime(30 * 1000);
        device._onNoResponse();

        // 60s after the FIRST no_response the reconnect should fire once
        jest.advanceTimersByTime(30 * 1000);
        expect(device.reconnect).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(60 * 1000);
        expect(device.reconnect).toHaveBeenCalledTimes(1);
    });

    test('does not reconnect when the HVAC starts responding again', () => {
        device._onNoResponse();
        jest.advanceTimersByTime(30 * 1000);

        // Any update from the HVAC cancels the scheduled reconnect
        device._onUpdate({}, {});

        jest.advanceTimersByTime(120 * 1000);
        expect(device.reconnect).not.toHaveBeenCalled();
    });

    test('reconnect() cancels a pending no-response reconnect', () => {
        const { reconnect } = GreeHVACDevice.prototype;
        device._markOffline = jest.fn();
        device._tryToDisconnect = jest.fn();
        device._startLookingForDevice = jest.fn();

        device._onNoResponse();
        reconnect.call(device);

        expect(device._noResponseReconnectTimeoutRef).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });
});
