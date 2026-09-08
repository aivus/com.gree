'use strict';

const { CloudConnection } = require('../drivers/gree_cloud_hvac/network/connection');
const { CloudError, ERROR } = require('../drivers/gree_cloud_hvac/network/errors');

const MAC = 'c03937a616ab';
const KEY = 'vyJb0KU05QjdCiZm';

/**
 * Build a connection with stubbed REST and MQTT clients.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
function build(overrides = {}) {
    const rest = {
        login: jest.fn(async () => ({ uid: 42, token: 'tok' })),
        getHomes: jest.fn(async () => [{ id: 7, name: 'Home' }]),
        getDevices: jest.fn(async () => [{ mac: MAC, key: KEY, name: 'Living room' }]),
        getMqttAddress: jest.fn(async () => ({ host: 'mqtt-eu.gree.com', port: 1984 })),
    };

    const mqttClients = [];
    const createMqttClient = jest.fn((options) => {
        const client = {
            options,
            connected: false,
            // The real client keys devices by MAC, so re-attaching one is a
            // no-op rather than a duplicate.
            attached: new Map(),
            connect: jest.fn(async () => {
                client.connected = true;
            }),
            attachDevice: jest.fn(async (device) => {
                client.attached.set(device.mac, device);
            }),
            detachDevice: jest.fn(),
            getStatus: jest.fn(async () => ({ cols: ['Pow'], dat: [1] })),
            setProperties: jest.fn(async () => ({ opt: ['Pow'], p: [1] })),
            disconnect: jest.fn(() => {
                client.connected = false;
            }),
        };
        mqttClients.push(client);
        return client;
    });

    const onAccountChange = jest.fn();

    const connection = new CloudConnection({
        region: 'europe',
        username: 'user@example.com',
        password: 'secret',
        createRestClient: () => rest,
        createMqttClient,
        onAccountChange,
        ...overrides,
    });

    return {
        connection, rest, mqttClients, createMqttClient, onAccountChange,
    };
}

describe('CloudConnection.authenticate()', () => {
    it('signs in and reports the new token', async () => {
        const { connection, rest, onAccountChange } = build();

        await expect(connection.authenticate()).resolves.toEqual({ uid: 42, token: 'tok' });
        expect(rest.login).toHaveBeenCalledWith('user@example.com', 'secret');
        expect(onAccountChange).toHaveBeenCalledWith({ uid: 42, token: 'tok' });
    });

    it('reuses a stored token instead of signing in again', async () => {
        const { connection, rest } = build({ account: { uid: 1, token: 'stored' } });

        await expect(connection.authenticate()).resolves.toEqual({ uid: 1, token: 'stored' });
        expect(rest.login).not.toHaveBeenCalled();
    });

    it('signs in again when forced', async () => {
        const { connection, rest } = build({ account: { uid: 1, token: 'stored' } });

        await connection.authenticate(true);
        expect(rest.login).toHaveBeenCalledTimes(1);
    });
});

describe('CloudConnection.listDevices()', () => {
    it('collects devices from every home and tags them with the home', async () => {
        const { connection } = build();

        await expect(connection.listDevices()).resolves.toEqual([{
            mac: MAC, key: KEY, name: 'Living room', homeId: 7, homeName: 'Home',
        }]);
    });

    it('deduplicates devices that share a key', async () => {
        const { connection, rest } = build();
        rest.getDevices.mockResolvedValue([
            { mac: 'aabbccddeeff', key: 'k1' },
            { mac: 'aabbccddeeff00', key: 'k1' },
        ]);

        const devices = await connection.listDevices();

        expect(devices).toHaveLength(1);
        expect(devices[0].mac).toBe('aabbccddeeff00');
    });

    it('signs in again and retries once when the session has expired', async () => {
        const { connection, rest } = build({ account: { uid: 1, token: 'stale' } });
        rest.getHomes
            .mockRejectedValueOnce(new CloudError(ERROR.SESSION_EXPIRED, 'stale token'))
            .mockResolvedValueOnce([{ id: 7, name: 'Home' }]);

        await expect(connection.listDevices()).resolves.toHaveLength(1);
        expect(rest.login).toHaveBeenCalledTimes(1);
    });

    it('does not retry a failure that is not a session expiry', async () => {
        const { connection, rest } = build();
        rest.getHomes.mockRejectedValue(new CloudError(ERROR.NETWORK, 'offline'));

        await expect(connection.listDevices()).rejects.toMatchObject({ reason: ERROR.NETWORK });
        expect(rest.getHomes).toHaveBeenCalledTimes(1);
    });
});

describe('CloudConnection.connect()', () => {
    it('looks the broker up rather than assuming a hostname', async () => {
        const { connection, rest, createMqttClient } = build();

        await connection.connect();

        expect(rest.getMqttAddress).toHaveBeenCalled();
        expect(createMqttClient).toHaveBeenCalledWith(expect.objectContaining({
            host: 'mqtt-eu.gree.com', port: 1984, uid: 42, token: 'tok',
        }));
    });

    it('shares one handshake between concurrent callers', async () => {
        const { connection, createMqttClient } = build();

        await Promise.all([connection.connect(), connection.connect(), connection.connect()]);

        expect(createMqttClient).toHaveBeenCalledTimes(1);
    });

    it('does nothing when already connected', async () => {
        const { connection, createMqttClient } = build();
        await connection.connect();
        await connection.connect();

        expect(createMqttClient).toHaveBeenCalledTimes(1);
    });
});

describe('CloudConnection device attachment', () => {
    it('opens the connection and attaches the device', async () => {
        const { connection, mqttClients } = build();

        await connection.attachDevice({ mac: MAC, key: KEY, onProperties: () => {} });

        expect(connection.connected).toBe(true);
        expect(mqttClients[0].attached.size).toBe(1);
        expect(connection.references).toBe(1);
    });

    it('shares one broker connection between devices on the same account', async () => {
        const { connection, createMqttClient } = build();

        await connection.attachDevice({ mac: MAC, key: KEY });
        await connection.attachDevice({ mac: 'aabbccddeeff', key: KEY });

        // A Gree account allows a single session, so one connection is required.
        expect(createMqttClient).toHaveBeenCalledTimes(1);
        expect(connection.references).toBe(2);
    });

    it('closes the connection when the last device detaches', async () => {
        const { connection, mqttClients } = build();
        await connection.attachDevice({ mac: MAC, key: KEY });
        await connection.attachDevice({ mac: 'aabbccddeeff', key: KEY });

        connection.detachDevice(MAC);
        expect(connection.connected).toBe(true);

        connection.detachDevice('aabbccddeeff');
        expect(mqttClients[0].disconnect).toHaveBeenCalled();
        expect(connection.references).toBe(0);
    });

    it('leaves no reference behind when attaching fails', async () => {
        const { connection, rest } = build();
        rest.getMqttAddress.mockRejectedValue(new CloudError(ERROR.NETWORK, 'offline'));

        await expect(connection.attachDevice({ mac: MAC, key: KEY }))
            .rejects.toMatchObject({ reason: ERROR.NETWORK });
        expect(connection.references).toBe(0);
    });
});

describe('CloudConnection state transfer', () => {
    it('reads status through the broker', async () => {
        const { connection } = build();
        await connection.attachDevice({ mac: MAC, key: KEY });

        await expect(connection.getStatus(MAC, ['Pow'])).resolves.toEqual({ cols: ['Pow'], dat: [1] });
    });

    it('writes properties through the broker', async () => {
        const { connection, mqttClients } = build();
        await connection.attachDevice({ mac: MAC, key: KEY });

        await connection.setProperties(MAC, { Pow: 1 });
        expect(mqttClients[0].setProperties).toHaveBeenCalledWith(MAC, { Pow: 1 });
    });

    it('reconnects and re-attaches the devices when the broker rejects the token', async () => {
        const { connection, mqttClients, createMqttClient } = build();
        await connection.attachDevice({ mac: MAC, key: KEY, onProperties: () => {} });

        mqttClients[0].getStatus.mockRejectedValueOnce(
            new CloudError(ERROR.SESSION_EXPIRED, 'bad user name'),
        );

        await expect(connection.getStatus(MAC, ['Pow'])).resolves.toEqual({ cols: ['Pow'], dat: [1] });

        // A rebuilt client starts empty, so the device must be attached again or
        // its replies would never be routed.
        expect(createMqttClient).toHaveBeenCalledTimes(2);
        expect([...mqttClients[1].attached.keys()]).toEqual([MAC]);
    });

    it('reopens the connection when it dropped without an error', async () => {
        const { connection, mqttClients } = build();
        await connection.attachDevice({ mac: MAC, key: KEY });

        mqttClients[0].connected = false;
        await connection.getStatus(MAC, ['Pow']);

        expect(connection.connected).toBe(true);
    });

    it('does not reconnect for an ordinary failure', async () => {
        const { connection, mqttClients, createMqttClient } = build();
        await connection.attachDevice({ mac: MAC, key: KEY });

        mqttClients[0].getStatus.mockRejectedValue(new CloudError(ERROR.NETWORK, 'timeout'));

        await expect(connection.getStatus(MAC, ['Pow'])).rejects.toMatchObject({ reason: ERROR.NETWORK });
        expect(createMqttClient).toHaveBeenCalledTimes(1);
    });
});

describe('CloudConnection.stop()', () => {
    it('closes the connection and forgets every device', async () => {
        const { connection, mqttClients } = build();
        await connection.attachDevice({ mac: MAC, key: KEY });

        connection.stop();

        expect(mqttClients[0].disconnect).toHaveBeenCalled();
        expect(connection.references).toBe(0);
    });

    it('survives being called twice', async () => {
        const { connection } = build();
        await connection.attachDevice({ mac: MAC, key: KEY });

        connection.stop();
        expect(() => connection.stop()).not.toThrow();
    });
});
