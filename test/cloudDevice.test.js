'use strict';

/**
 * Build a cloud device with the Homey SDK and the shared session mocked out.
 *
 * @param {object} [options]
 * @returns {object}
 */
function build({ store = {}, settings = {}, accounts } = {}) {
    jest.resetModules();

    const connection = {
        attachDevice: jest.fn(async () => {}),
        detachDevice: jest.fn(),
        getStatus: jest.fn(async () => ({ cols: [], dat: [] })),
        setProperties: jest.fn(async () => ({})),
    };

    const mockSession = {
        getConnection: jest.fn(() => connection),
        release: jest.fn(),
        stop: jest.fn(),
    };

    jest.doMock('../drivers/gree_cloud_hvac/network/session', () => mockSession);
    jest.doMock('homey', () => ({
        Device: class Device {

            log() {}

            error() {}

        },
    }));

    // eslint-disable-next-line global-require
    const GreeCloudHVACDevice = require('../drivers/gree_cloud_hvac/device');

    const capabilityListeners = {};
    const capabilityValues = {};
    const triggers = {};
    const timers = [];

    const deviceStore = {
        mac: 'c03937a616ab',
        key: 'vyJb0KU05QjdCiZm',
        region: 'europe',
        account_key: 'europe:user@example.com',
        ...store,
    };

    const appSettings = {
        cloud_accounts: accounts !== undefined ? accounts : {
            'europe:user@example.com': {
                region: 'europe',
                email: 'user@example.com',
                password: 'secret',
                account: { uid: 42, token: 'tok' },
            },
        },
    };

    const device = new GreeCloudHVACDevice();

    device.log = jest.fn();
    device.error = jest.fn();
    device.getData = () => ({ id: deviceStore.mac, mac: deviceStore.mac });
    device.getStoreValue = jest.fn((key) => deviceStore[key]);
    device.setStoreValue = jest.fn(async (key, value) => {
        deviceStore[key] = value;
    });
    device.getSetting = jest.fn((key) => settings[key]);
    device.setCapabilityOptions = jest.fn(async () => {});
    device.registerCapabilityListener = jest.fn((capability, listener) => {
        capabilityListeners[capability] = listener;
    });
    device.setCapabilityValue = jest.fn(async (capability, value) => {
        capabilityValues[capability] = value;
    });
    device.getCapabilityValue = jest.fn((capability) => (
        capability in capabilityValues ? capabilityValues[capability] : null
    ));
    device.setAvailable = jest.fn(async () => {
        device._available = true;
    });
    device.setUnavailable = jest.fn(async () => {
        device._available = false;
    });
    device.getAvailable = jest.fn(() => Boolean(device._available));

    device.homey = {
        __: jest.fn((key) => key),
        settings: {
            get: jest.fn((key) => appSettings[key]),
            set: jest.fn((key, value) => {
                appSettings[key] = value;
            }),
        },
        flow: {
            getDeviceTriggerCard: jest.fn((id) => {
                triggers[id] = { trigger: jest.fn(async () => {}) };
                return triggers[id];
            }),
        },
        setInterval: jest.fn((fn, ms) => {
            const ref = { fn, ms, type: 'interval' };
            timers.push(ref);
            return ref;
        }),
        clearInterval: jest.fn((ref) => {
            const index = timers.indexOf(ref);
            if (index !== -1) {
                timers.splice(index, 1);
            }
        }),
        setTimeout: jest.fn((fn, ms) => {
            const ref = { fn, ms, type: 'timeout' };
            timers.push(ref);
            return ref;
        }),
        clearTimeout: jest.fn((ref) => {
            const index = timers.indexOf(ref);
            if (index !== -1) {
                timers.splice(index, 1);
            }
        }),
    };

    return {
        device, connection, mockSession, capabilityListeners, capabilityValues, triggers, timers, appSettings, deviceStore,
    };
}

/**
 * Let the promise chains inside _onUpdate settle.
 *
 * @returns {Promise<void>}
 */
async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('GreeCloudHVACDevice attaching', () => {
    it('attaches to the shared connection for its account', async () => {
        const { device, connection, mockSession } = build();
        await device.onInit();

        expect(mockSession.getConnection).toHaveBeenCalledWith(expect.objectContaining({
            region: 'europe',
            username: 'user@example.com',
            password: 'secret',
            account: { uid: 42, token: 'tok' },
        }));
        expect(connection.attachDevice).toHaveBeenCalledWith(expect.objectContaining({
            mac: 'c03937a616ab',
            key: 'vyJb0KU05QjdCiZm',
        }));
        expect(device.setAvailable).toHaveBeenCalled();
    });

    it('polls once immediately after attaching', async () => {
        const { device, connection } = build();
        await device.onInit();

        expect(connection.getStatus).toHaveBeenCalledWith('c03937a616ab', expect.arrayContaining(['Pow', 'Mod']));
    });

    it('asks for a repair when no account is stored', async () => {
        const { device, mockSession } = build({ accounts: {} });
        await device.onInit();

        expect(mockSession.getConnection).not.toHaveBeenCalled();
        expect(device.setUnavailable).toHaveBeenCalledWith('error.cloud.session_expired');
    });

    it('explains a device the cloud gave no key for', async () => {
        const { device, mockSession } = build({ store: { key: undefined } });
        await device.onInit();

        expect(mockSession.getConnection).not.toHaveBeenCalled();
        expect(device.setUnavailable).toHaveBeenCalledWith('error.cloud.missing_key');
    });

    it('keeps retrying when attaching fails', async () => {
        const { device, connection, timers } = build();
        connection.attachDevice.mockRejectedValue(new Error('offline'));

        await device.onInit();

        expect(device.setUnavailable).toHaveBeenCalled();
        expect(timers.some((timer) => timer.type === 'interval')).toBe(true);
    });

    it('persists a token the cloud hands out', async () => {
        const { device, mockSession, appSettings } = build();
        await device.onInit();

        const { onAccountChange } = mockSession.getConnection.mock.calls[0][0];
        onAccountChange({ uid: 42, token: 'refreshed' });

        expect(appSettings.cloud_accounts['europe:user@example.com'].account)
            .toEqual({ uid: 42, token: 'refreshed' });
    });

    it('does not use the local network finder', () => {
        // Requiring it would bind a UDP socket the cloud driver has no use for.
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'drivers', 'gree_cloud_hvac', 'device.js'),
            'utf8',
        );

        expect(source).not.toContain('finder');
    });
});

describe('GreeCloudHVACDevice capability writes', () => {
    it('translates every capability into its vendor property', async () => {
        const { device, connection, capabilityListeners } = build();
        await device.onInit();
        connection.setProperties.mockClear();

        const cases = [
            ['onoff', true, { Pow: 1 }],
            ['target_temperature', 22, { SetTem: 22 }],
            ['fan_speed', 'mediumHigh', { WdSpd: 4 }],
            ['turbo_mode', true, { Tur: 1 }],
            ['safety_heating', true, { StHt: 1 }],
            ['lights', false, { Lig: 0 }],
            ['xfan_mode', true, { Blo: 1 }],
            ['vertical_swing', 'fixedBottom', { SwUpDn: 6 }],
            ['horizontal_swing', 'fixedRight', { SwingLfRig: 6 }],
            ['quiet_mode', 'mode2', { Quiet: 2 }],
            ['health_mode', true, { Health: 1 }],
            ['power_save_mode', true, { SvSt: 1 }],
            ['fresh_air_mode', 'outside', { Air: 2 }],
        ];

        for (const [capability, value, expected] of cases) {
            connection.setProperties.mockClear();
            // eslint-disable-next-line no-await-in-loop
            await capabilityListeners[capability](value);

            expect(connection.setProperties).toHaveBeenCalledWith('c03937a616ab', expected);
        }
    });

    it('writes the sleep switch and its companion field together', async () => {
        const { device, connection, capabilityListeners } = build();
        await device.onInit();
        connection.setProperties.mockClear();

        await capabilityListeners.sleep_mode(true);

        // Many units ignore SwhSlp unless SlpMod moves with it.
        expect(connection.setProperties).toHaveBeenCalledWith('c03937a616ab', { SwhSlp: 1, SlpMod: 1 });
    });

    it('sets the mode before powering a unit on, in separate ordered commands', async () => {
        const { device, connection, capabilityListeners } = build();
        await device.onInit();
        device._onUpdate({ power: 'off', mode: 'cool' });
        connection.setProperties.mockClear();

        await capabilityListeners.thermostat_mode('heat');

        // The cloud ignores all but the first of a batch, and starting the unit
        // before its mode is set makes it run in the previous mode.
        expect(connection.setProperties.mock.calls.map((call) => call[1]))
            .toEqual([{ Mod: 4 }, { Pow: 1 }]);
    });

    it('does not touch power when the unit is already running', async () => {
        const { device, connection, capabilityListeners } = build();
        await device.onInit();
        device._onUpdate({ power: 'on', mode: 'cool' });
        connection.setProperties.mockClear();

        await capabilityListeners.thermostat_mode('heat');

        expect(connection.setProperties.mock.calls.map((call) => call[1])).toEqual([{ Mod: 4 }]);
    });

    it('turns the unit off for the off thermostat mode', async () => {
        const { device, connection, capabilityListeners } = build();
        await device.onInit();
        connection.setProperties.mockClear();

        await capabilityListeners.thermostat_mode('off');

        expect(connection.setProperties).toHaveBeenCalledWith('c03937a616ab', { Pow: 0 });
    });

    it('rejects an unknown enum value without contacting the cloud', async () => {
        const { device, connection, capabilityListeners } = build();
        await device.onInit();
        connection.setProperties.mockClear();

        await expect(capabilityListeners.fan_speed('turbocharged')).rejects.toThrow(/Unknown fan speed/);
        await expect(capabilityListeners.thermostat_mode('boost')).rejects.toThrow(/Unknown thermostat_mode/);
        expect(connection.setProperties).not.toHaveBeenCalled();
    });

    it('rejects a write when not connected, so Homey reverts the capability', async () => {
        const { device, capabilityListeners } = build({ accounts: {} });
        await device.onInit();

        await expect(capabilityListeners.onoff(true)).rejects.toThrow('error.not_connected');
    });

    it('rejects a write the cloud refused', async () => {
        const { device, connection, capabilityListeners } = build();
        await device.onInit();
        connection.setProperties.mockRejectedValue(new Error('timeout'));

        await expect(capabilityListeners.onoff(true)).rejects.toThrow('error.not_connected');
    });

    it('marks the device offline when the cloud says the session is gone', async () => {
        const { device, connection, capabilityListeners } = build();
        await device.onInit();
        // eslint-disable-next-line global-require
        const { CloudError, ERROR } = require('../drivers/gree_cloud_hvac/network/errors');
        connection.setProperties.mockRejectedValue(
            new CloudError(ERROR.SESSION_EXPIRED, 'bad token'),
        );

        await expect(capabilityListeners.onoff(true)).rejects.toThrow('error.not_connected');
        expect(device.setUnavailable).toHaveBeenCalledWith('error.cloud.session_expired');
    });

    it('runs writes strictly one at a time', async () => {
        const { device, connection, capabilityListeners } = build();
        await device.onInit();

        let running = 0;
        let overlapped = false;
        connection.setProperties.mockImplementation(() => new Promise((resolve) => {
            running += 1;
            if (running > 1) {
                overlapped = true;
            }
            setImmediate(() => {
                running -= 1;
                resolve({});
            });
        }));

        await Promise.all([
            capabilityListeners.lights(true),
            capabilityListeners.turbo_mode(true),
            capabilityListeners.health_mode(true),
        ]);

        expect(overlapped).toBe(false);
    });
});

describe('GreeCloudHVACDevice state updates', () => {
    it('maps a status reply onto capabilities', async () => {
        const { device, capabilityValues } = build();
        await device.onInit();

        device._onUpdate({
            power: 'on',
            mode: 'heat',
            temperature: 22,
            currentTemperature: 21,
            fanSpeed: 'low',
            lights: 'on',
        });
        await flush();

        expect(capabilityValues).toMatchObject({
            onoff: true,
            thermostat_mode: 'heat',
            target_temperature: 22,
            measure_temperature: 21,
            fan_speed: 'low',
            lights: true,
        });
    });

    it('reports thermostat mode as off while the unit is off', async () => {
        const { device, capabilityValues } = build();
        await device.onInit();

        device._onUpdate({ power: 'on', mode: 'cool' });
        device._onUpdate({ power: 'off' });
        await flush();

        expect(capabilityValues.onoff).toBe(false);
        expect(capabilityValues.thermostat_mode).toBe('off');
    });

    it('treats an unsupported temperature sensor as no reading', async () => {
        const { device, device: { setCapabilityValue }, capabilityValues } = build();
        await device.onInit();
        setCapabilityValue.mockClear();

        // A zero reading against an unset capability means "no sensor", which is
        // not a change worth reporting.
        device._onUpdate({ currentTemperature: 0 });
        expect(setCapabilityValue).not.toHaveBeenCalled();

        // Once a real reading has arrived, a zero does clear it.
        device._onUpdate({ currentTemperature: 21 });
        await flush();
        expect(capabilityValues.measure_temperature).toBe(21);

        device._onUpdate({ currentTemperature: 0 });
        await flush();
        expect(capabilityValues.measure_temperature).toBeNull();
    });

    it('fires a trigger only when a value actually changed', async () => {
        const { device, triggers } = build();
        await device.onInit();

        device._onUpdate({ fanSpeed: 'low' });
        await flush();
        expect(triggers.fan_speed_changed.trigger).toHaveBeenCalledTimes(1);

        triggers.fan_speed_changed.trigger.mockClear();
        device._onUpdate({ fanSpeed: 'low' });
        await flush();
        expect(triggers.fan_speed_changed.trigger).not.toHaveBeenCalled();

        device._onUpdate({ fanSpeed: 'high' });
        await flush();
        expect(triggers.fan_speed_changed.trigger).toHaveBeenCalledTimes(1);
    });

    it('never registers the deprecated HVAC mode trigger', async () => {
        const { device } = build();
        await device.onInit();

        // Deprecated cards stay restricted to the local driver.
        expect(device.homey.flow.getDeviceTriggerCard).not.toHaveBeenCalledWith('hvac_mode_changed');
    });

    it('registers a trigger for each of the twelve current change cards', async () => {
        const { device } = build();
        await device.onInit();

        const ids = device.homey.flow.getDeviceTriggerCard.mock.calls.map(([id]) => id);
        expect(ids).toHaveLength(12);
        expect(new Set(ids).size).toBe(12);
    });

    it('brings the device back online when the cloud answers again', async () => {
        const { device } = build();
        await device.onInit();
        device._markOffline();
        device.setAvailable.mockClear();

        device._onUpdate({ power: 'on' });

        expect(device.setAvailable).toHaveBeenCalled();
    });

    it('ignores an empty reply', async () => {
        const { device } = build();
        await device.onInit();
        device.setCapabilityValue.mockClear();

        device._onUpdate({});

        expect(device.setCapabilityValue).not.toHaveBeenCalled();
    });
});

describe('GreeCloudHVACDevice offline handling', () => {
    it('marks the device offline when a poll fails', async () => {
        const { device, connection } = build();
        await device.onInit();
        connection.getStatus.mockRejectedValue(new Error('timeout'));

        await device._poll();

        expect(device.setUnavailable).toHaveBeenCalled();
    });

    it('schedules a reconnect after a prolonged silence', async () => {
        const { device, connection, timers } = build();
        await device.onInit();
        connection.getStatus.mockRejectedValue(new Error('timeout'));

        await device._poll();

        const scheduled = timers.filter((timer) => timer.type === 'timeout');
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].ms).toBe(180000);
    });

    it('cancels the pending reconnect once the cloud answers', async () => {
        const { device, connection, timers } = build();
        await device.onInit();
        connection.getStatus.mockRejectedValue(new Error('timeout'));
        await device._poll();

        device._onUpdate({ power: 'on' });

        expect(timers.filter((timer) => timer.type === 'timeout')).toEqual([]);
    });

    it('polls on the interval from its settings', async () => {
        const { device, timers } = build({ settings: { polling_interval: 120000 } });
        await device.onInit();

        expect(timers.some((timer) => timer.type === 'interval' && timer.ms === 120000)).toBe(true);
    });
});

describe('GreeCloudHVACDevice cleanup', () => {
    it('detaches and clears every timer when deleted', async () => {
        const { device, connection, timers } = build();
        await device.onInit();

        device.onDeleted();

        expect(connection.detachDevice).toHaveBeenCalledWith('c03937a616ab');
        expect(timers).toEqual([]);
    });

    it('detaches and clears every timer when the app shuts down', async () => {
        const { device, connection, timers } = build();
        await device.onInit();

        await device.onUninit();

        expect(connection.detachDevice).toHaveBeenCalledWith('c03937a616ab');
        expect(timers).toEqual([]);
    });

    it('survives a detach that throws', async () => {
        const { device, connection } = build();
        await device.onInit();
        connection.detachDevice.mockImplementation(() => {
            throw new Error('already gone');
        });

        expect(() => device.onDeleted()).not.toThrow();
    });

    it('does not detach twice', async () => {
        const { device, connection } = build();
        await device.onInit();

        device.onDeleted();
        device.onDeleted();

        expect(connection.detachDevice).toHaveBeenCalledTimes(1);
    });

    it('reattaches on reconnect', async () => {
        const { device, connection } = build();
        await device.onInit();
        connection.attachDevice.mockClear();

        device.reconnect();
        await Promise.resolve();

        expect(connection.detachDevice).toHaveBeenCalled();
        expect(connection.attachDevice).toHaveBeenCalled();
    });
});
