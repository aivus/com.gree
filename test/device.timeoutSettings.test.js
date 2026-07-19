'use strict';

describe('GreeHVACDevice configurable timeouts', () => {
    let GreeHVACDevice;
    let ClientMock;
    let device;

    beforeEach(() => {
        jest.resetModules();

        ClientMock = jest.fn().mockImplementation(() => ({}));

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));

        jest.doMock('gree-hvac-client', () => ({
            Client: ClientMock,
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
        device.log = jest.fn();
        device.reconnect = jest.fn();
        device._registerClientListeners = jest.fn();
    });

    describe('_connectToHost', () => {
        test('passes the configured timeouts to the HVAC client', () => {
            const settings = {
                polling_interval: 8000,
                polling_timeout: 6000,
                connect_timeout: 9000,
            };
            device.getSetting = jest.fn((id) => settings[id]);

            device._connectToHost('10.0.0.5');

            expect(ClientMock).toHaveBeenCalledTimes(1);
            expect(ClientMock).toHaveBeenCalledWith(expect.objectContaining({
                host: '10.0.0.5',
                pollingInterval: 8000,
                pollingTimeout: 6000,
                connectTimeout: 9000,
            }));
        });

        test('falls back to the default timeouts when the settings are unset', () => {
            device.getSetting = jest.fn(() => undefined);

            device._connectToHost('10.0.0.5');

            expect(ClientMock).toHaveBeenCalledWith(expect.objectContaining({
                pollingInterval: 3500,
                pollingTimeout: 3000,
                connectTimeout: 5000,
            }));
        });
    });

    describe('_scheduleNoResponseReconnect', () => {
        beforeEach(() => {
            jest.useFakeTimers();
            device.homey = {
                setTimeout: (fn, ms) => setTimeout(fn, ms),
                clearTimeout: (ref) => clearTimeout(ref),
            };
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('uses the configured no-response reconnect timeout', () => {
            device.getSetting = jest.fn(() => 20000);

            device._scheduleNoResponseReconnect();

            jest.advanceTimersByTime(19000);
            expect(device.reconnect).not.toHaveBeenCalled();

            jest.advanceTimersByTime(1000);
            expect(device.reconnect).toHaveBeenCalledTimes(1);
        });

        test('falls back to the default no-response reconnect timeout when unset', () => {
            device.getSetting = jest.fn(() => undefined);

            device._scheduleNoResponseReconnect();

            jest.advanceTimersByTime(60 * 1000);
            expect(device.reconnect).toHaveBeenCalledTimes(1);
        });
    });

    describe('onSettings', () => {
        beforeEach(() => {
            device.getSetting = jest.fn(() => undefined);
        });

        const expectReconnectOnChange = async (key) => {
            device._client = {};

            await device.onSettings({
                oldSettings: { [key]: 3000 },
                newSettings: { [key]: 8000 },
                changedKeys: [key],
            });

            expect(device.reconnect).toHaveBeenCalledTimes(1);
        };

        test('reconnects when polling_interval changes while connected', async () => {
            await expectReconnectOnChange('polling_interval');
        });

        test('reconnects when polling_timeout changes while connected', async () => {
            await expectReconnectOnChange('polling_timeout');
        });

        test('reconnects when connect_timeout changes while connected', async () => {
            await expectReconnectOnChange('connect_timeout');
        });

        test('does not reconnect when a client timeout changes but no client is connected', async () => {
            device._client = null;

            await device.onSettings({
                oldSettings: { polling_interval: 3500 },
                newSettings: { polling_interval: 8000 },
                changedKeys: ['polling_interval'],
            });

            expect(device.reconnect).not.toHaveBeenCalled();
        });

        test('uses the new timeout when reconnecting, before Homey persists it', async () => {
            // getSetting still returns the OLD value during onSettings
            device.getSetting = jest.fn(() => 3500);
            device._client = {};
            device._registerClientListeners = jest.fn();
            device.reconnect = jest.fn(() => device._connectToHost('10.0.0.5'));

            await device.onSettings({
                oldSettings: { polling_interval: 3500 },
                newSettings: { polling_interval: 9000 },
                changedKeys: ['polling_interval'],
            });

            expect(ClientMock).toHaveBeenCalledWith(expect.objectContaining({
                pollingInterval: 9000,
            }));
        });

        test('does not reconnect when only the no-response reconnect timeout changes', async () => {
            device._client = {};

            await device.onSettings({
                oldSettings: { no_response_reconnect_timeout: 60000 },
                newSettings: { no_response_reconnect_timeout: 120000 },
                changedKeys: ['no_response_reconnect_timeout'],
            });

            expect(device.reconnect).not.toHaveBeenCalled();
        });
    });
});
