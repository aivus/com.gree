'use strict';

describe('GreeCloudHVACDriver repair', () => {
    let driver;
    let handlers;
    let mockSession;
    let settings;
    let device;
    let deviceStore;
    let deviceSettings;

    beforeEach(() => {
        jest.resetModules();

        handlers = {};
        settings = {
            cloud_accounts: {
                'europe:old@example.com': {
                    region: 'europe',
                    email: 'old@example.com',
                    password: 'old',
                    account: { uid: 1, token: 'stale' },
                },
            },
        };

        deviceStore = {
            mac: 'c03937a616ab',
            key: 'oldkey0123456789',
            region: 'europe',
            account_key: 'europe:old@example.com',
        };
        deviceSettings = { account_email: 'old@example.com' };

        mockSession = {
            signIn: jest.fn(async () => ({
                account: { uid: 42, token: 'fresh' },
                devices: [{ mac: 'c03937a616ab', key: 'newkey0123456789', name: 'Living room' }],
            })),
            release: jest.fn(),
            stop: jest.fn(),
            accountKey: (region, username) => `${region}:${String(username).toLowerCase()}`,
        };

        jest.doMock('../drivers/gree_cloud_hvac/network/session', () => mockSession);
        jest.doMock('homey', () => ({
            Driver: class Driver {

                log() {}

                error() {}

            },
        }));

        // eslint-disable-next-line global-require
        const GreeCloudHVACDriver = require('../drivers/gree_cloud_hvac/driver');

        driver = new GreeCloudHVACDriver();
        driver.log = jest.fn();
        driver.error = jest.fn();
        driver.homey = {
            __: jest.fn((key) => key),
            settings: {
                get: jest.fn((key) => settings[key]),
                set: jest.fn((key, value) => {
                    settings[key] = value;
                }),
            },
        };
        driver._session = mockSession;

        device = {
            getMac: () => deviceStore.mac,
            getStoreValue: jest.fn((key) => deviceStore[key]),
            setStoreValue: jest.fn(async (key, value) => {
                deviceStore[key] = value;
            }),
            getSetting: jest.fn((key) => deviceSettings[key]),
            setSettings: jest.fn(async (values) => Object.assign(deviceSettings, values)),
            reconnect: jest.fn(),
        };

        driver.onRepair({
            setHandler: (event, handler) => {
                handlers[event] = handler;
            },
        }, device);
    });

    it('preselects the region the device is bound to', async () => {
        deviceStore.region = 'china';
        const regions = await handlers.get_regions();

        expect(regions.filter((region) => region.selected).map((region) => region.id))
            .toEqual(['china']);
    });

    it('prefills the account address but never the password', async () => {
        await expect(handlers.get_account()).resolves.toEqual({
            email: 'old@example.com',
            region: 'europe',
        });

        const account = await handlers.get_account();
        expect(Object.keys(account)).not.toContain('password');
    });

    const credentials = { region: 'europe', email: 'new@example.com', password: 'fresh-secret' };

    it('rotates the key, rebinds the account and reconnects', async () => {
        await expect(handlers.relogin(credentials)).resolves.toBe(true);

        expect(deviceStore.key).toBe('newkey0123456789');
        expect(deviceStore.account_key).toBe('europe:new@example.com');
        expect(deviceSettings.account_email).toBe('new@example.com');
        expect(device.reconnect).toHaveBeenCalled();
    });

    it('stores the new credentials and token', async () => {
        await handlers.relogin(credentials);

        expect(settings.cloud_accounts['europe:new@example.com']).toEqual({
            region: 'europe',
            email: 'new@example.com',
            password: 'fresh-secret',
            account: { uid: 42, token: 'fresh' },
        });
    });

    it('drops the connection that used the previous credentials', async () => {
        await handlers.relogin(credentials);

        expect(mockSession.release).toHaveBeenCalledWith('europe', 'old@example.com');
    });

    it('refuses when the device is not in the account signed in to', async () => {
        mockSession.signIn.mockResolvedValue({
            account: {},
            devices: [{ mac: 'someotherdevice', key: 'k' }],
        });

        await expect(handlers.relogin(credentials))
            .rejects.toThrow('repair.cloud.device_not_found');
        expect(device.reconnect).not.toHaveBeenCalled();
    });

    it('refuses when the cloud returns no key for the device', async () => {
        mockSession.signIn.mockResolvedValue({
            account: {},
            devices: [{ mac: 'c03937a616ab', name: 'Living room' }],
        });

        await expect(handlers.relogin(credentials)).rejects.toThrow('error.cloud.missing_key');
    });

    it('reports wrong credentials without changing anything', async () => {
        // eslint-disable-next-line global-require
        const { CloudError, ERROR } = require('../drivers/gree_cloud_hvac/network/errors');
        mockSession.signIn.mockRejectedValue(
            new CloudError(ERROR.INVALID_CREDENTIALS, 'user not exist'),
        );

        await expect(handlers.relogin(credentials))
            .rejects.toThrow('error.cloud.invalid_credentials');
        expect(deviceStore.key).toBe('oldkey0123456789');
        expect(device.reconnect).not.toHaveBeenCalled();
    });

    it('rejects an unknown region', async () => {
        await expect(handlers.relogin({ ...credentials, region: 'atlantis' }))
            .rejects.toThrow('error.cloud.wrong_region');
    });
});
