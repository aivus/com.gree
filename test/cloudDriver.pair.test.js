'use strict';

describe('GreeCloudHVACDriver pairing', () => {
    let driver;
    let handlers;
    let mockSession;
    let settings;
    let pairedDevices;

    beforeEach(() => {
        jest.resetModules();

        handlers = {};
        settings = {};
        pairedDevices = [];

        mockSession = {
            signIn: jest.fn(async () => ({
                account: { uid: 42, token: 'tok' },
                devices: [{
                    mac: 'c03937a616ab',
                    key: 'vyJb0KU05QjdCiZm',
                    name: 'Living room',
                    homeId: 7,
                    ver: 'V3.2',
                    model: '32792',
                }],
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
        driver.getDevices = jest.fn(() => pairedDevices);
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

        driver.onPair({
            setHandler: (event, handler) => {
                handlers[event] = handler;
            },
        });
    });

    describe('get_regions', () => {
        it('offers all ten regions, localised, with Europe preselected', async () => {
            const regions = await handlers.get_regions();

            expect(regions).toHaveLength(10);
            expect(regions.map((region) => region.id)).toEqual([
                'australia', 'china', 'east_south_asia', 'europe', 'india',
                'latin_america', 'middle_east', 'north_america', 'russia', 'south_america',
            ]);
            expect(regions.filter((region) => region.selected).map((region) => region.id))
                .toEqual(['europe']);
            expect(regions[0].label).toBe('pair.cloud.regions.australia');
        });
    });

    describe('login', () => {
        const credentials = { region: 'europe', email: 'user@example.com', password: 'secret' };

        it('signs in and reports how many devices were found', async () => {
            await expect(handlers.login(credentials)).resolves.toEqual({ deviceCount: 1 });

            expect(mockSession.signIn).toHaveBeenCalledWith(expect.objectContaining({
                region: 'europe',
                username: 'user@example.com',
                password: 'secret',
            }));
        });

        it('trims the e-mail address', async () => {
            await handlers.login({ ...credentials, email: '  user@example.com ' });

            expect(mockSession.signIn).toHaveBeenCalledWith(expect.objectContaining({
                username: 'user@example.com',
            }));
        });

        it('stores the account so devices can sign in again unattended', async () => {
            await handlers.login(credentials);

            expect(settings.cloud_accounts).toEqual({
                'europe:user@example.com': {
                    region: 'europe',
                    email: 'user@example.com',
                    password: 'secret',
                    account: { uid: 42, token: 'tok' },
                },
            });
        });

        it('rejects an unknown region without contacting the cloud', async () => {
            await expect(handlers.login({ ...credentials, region: 'atlantis' }))
                .rejects.toThrow('error.cloud.wrong_region');
            expect(mockSession.signIn).not.toHaveBeenCalled();
        });

        it('rejects empty credentials without contacting the cloud', async () => {
            await expect(handlers.login({ ...credentials, email: '   ' }))
                .rejects.toThrow('error.cloud.invalid_credentials');
            await expect(handlers.login({ ...credentials, password: '' }))
                .rejects.toThrow('error.cloud.invalid_credentials');
            expect(mockSession.signIn).not.toHaveBeenCalled();
        });

        it('explains an account that has no air conditioners', async () => {
            mockSession.signIn.mockResolvedValue({ account: {}, devices: [] });

            await expect(handlers.login(credentials)).rejects.toThrow('error.cloud.no_devices');
        });

        it('maps each cloud failure onto its own message', async () => {
            // eslint-disable-next-line global-require
            const { CloudError, ERROR } = require('../drivers/gree_cloud_hvac/network/errors');

            const reasons = Object.values(ERROR);
            for (const reason of reasons) {
                mockSession.signIn.mockRejectedValueOnce(new CloudError(reason, 'technical detail'));

                // eslint-disable-next-line no-await-in-loop
                await expect(handlers.login(credentials)).rejects.toThrow(`error.cloud.${reason}`);
            }
        });

        it('never leaks the password into the error shown to the user', async () => {
            mockSession.signIn.mockRejectedValue(new Error('failed for user secret'));

            await expect(handlers.login(credentials)).rejects.toThrow('error.cloud.cloud');
        });

        it('does not store the account when signing in fails', async () => {
            mockSession.signIn.mockRejectedValue(new Error('nope'));

            await expect(handlers.login(credentials)).rejects.toThrow();
            expect(settings.cloud_accounts).toBeUndefined();
        });
    });

    describe('list_devices', () => {
        const credentials = { region: 'europe', email: 'user@example.com', password: 'secret' };

        it('returns nothing before a successful sign-in', async () => {
            await expect(handlers.list_devices()).resolves.toEqual([]);
        });

        it('describes a device with its identity, key and account', async () => {
            await handlers.login(credentials);

            await expect(handlers.list_devices()).resolves.toEqual([{
                name: 'Living room',
                data: { id: 'c03937a616ab', mac: 'c03937a616ab' },
                store: {
                    mac: 'c03937a616ab',
                    key: 'vyJb0KU05QjdCiZm',
                    region: 'europe',
                    account_key: 'europe:user@example.com',
                    home_id: 7,
                    version: 'V3.2',
                    model: '32792',
                },
                settings: {
                    account_email: 'user@example.com',
                    account_region: 'pair.cloud.regions.europe',
                    device_mac: 'c03937a616ab',
                },
            }]);
        });

        it('hides devices that are already paired', async () => {
            pairedDevices = [{ getMac: () => 'c03937a616ab' }];
            await handlers.login(credentials);

            await expect(handlers.list_devices()).resolves.toEqual([]);
        });

        it('hides devices the cloud gave no encryption key for', async () => {
            mockSession.signIn.mockResolvedValue({
                account: {},
                devices: [{ mac: 'aabbccddeeff', name: 'No key' }],
            });
            await handlers.login(credentials);

            await expect(handlers.list_devices()).resolves.toEqual([]);
        });

        it('falls back to the MAC when the cloud reports no name', async () => {
            mockSession.signIn.mockResolvedValue({
                account: {},
                devices: [{ mac: 'aabbccddeeff', key: 'k' }],
            });
            await handlers.login(credentials);

            const [device] = await handlers.list_devices();
            expect(device.name).toBe('aabbccddeeff');
        });
    });

    describe('onUninit', () => {
        it('closes every cloud connection', async () => {
            await driver.onInit();
            await driver.onUninit();

            expect(mockSession.stop).toHaveBeenCalled();
        });
    });
});
