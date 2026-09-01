'use strict';

const { EventEmitter } = require('events');
const {
    CloudMqttClient, resolveMacs, deduplicateDevices, DEFAULT_PORT,
} = require('../drivers/gree_cloud_hvac/network/mqtt');
const { CloudCipher } = require('../drivers/gree_cloud_hvac/network/crypto');
const { ERROR } = require('../drivers/gree_cloud_hvac/network/errors');

const DEVICE_KEY = 'vyJb0KU05QjdCiZm';
const MAC = 'c03937a616ab';

/**
 * A stand-in for an mqtt.js client.
 */
class FakeMqttClient extends EventEmitter {

    constructor() {
        super();
        this.connected = false;
        this.published = [];
        this.subscribed = [];
        this.ended = false;
        this.publishError = null;
        this.subscribeError = null;
    }

    publish(topic, message, options, callback) {
        this.published.push({ topic, message: JSON.parse(message), options });
        callback(this.publishError);
    }

    subscribe(topics, options, callback) {
        this.subscribed.push(topics);
        callback(this.subscribeError);
    }

    end() {
        this.ended = true;
    }

}

function buildClient(overrides = {}) {
    const fake = new FakeMqttClient();
    const connectOptions = {};

    const client = new CloudMqttClient({
        host: 'mqtt-eu.gree.com',
        uid: 42,
        token: 'tok',
        requestTimeout: 50,
        mqtt: {
            connect: (url, options) => {
                connectOptions.url = url;
                connectOptions.options = options;
                return fake;
            },
        },
        ...overrides,
    });

    return { client, fake, connectOptions };
}

async function connected(overrides = {}) {
    const built = buildClient(overrides);
    const promise = built.client.connect();
    built.fake.connected = true;
    built.fake.emit('connect');
    await promise;

    return built;
}

/**
 * Encrypt a reply the way a device would.
 *
 * @param {object} payload
 * @param {object} [envelope] Extra envelope fields
 * @returns {Buffer}
 */
function deviceReply(payload, envelope = {}) {
    const { pack } = new CloudCipher(DEVICE_KEY).encrypt(payload);

    return Buffer.from(JSON.stringify({ pack, ...envelope }));
}

describe('resolveMacs()', () => {
    it('treats a plain split unit as its own parent', () => {
        expect(resolveMacs(MAC)).toEqual({ parentMac: MAC, childMac: MAC });
    });

    it('derives the parent of a child device', () => {
        expect(resolveMacs('c03937a616ab00'))
            .toEqual({ parentMac: 'c03937a616ab', childMac: 'c03937a616ab00' });
    });

    it('does not treat a 12 character MAC ending in 00 as a child', () => {
        expect(resolveMacs('c03937a61600'))
            .toEqual({ parentMac: 'c03937a61600', childMac: 'c03937a61600' });
    });
});

describe('deduplicateDevices()', () => {
    it('keeps the "00" variant when two devices share a key', () => {
        const devices = [
            { mac: 'aabbccddeeff', key: 'k1' },
            { mac: 'aabbccddeeff00', key: 'k1' },
        ];

        expect(deduplicateDevices(devices)).toEqual([{ mac: 'aabbccddeeff00', key: 'k1' }]);
    });

    it('keeps the "00" variant regardless of the order it appears in', () => {
        const devices = [
            { mac: 'aabbccddeeff00', key: 'k1' },
            { mac: 'aabbccddeeff', key: 'k1' },
        ];

        expect(deduplicateDevices(devices)).toEqual([{ mac: 'aabbccddeeff00', key: 'k1' }]);
    });

    it('keeps devices with distinct keys', () => {
        const devices = [{ mac: 'a', key: 'k1' }, { mac: 'b', key: 'k2' }];

        expect(deduplicateDevices(devices)).toHaveLength(2);
    });

    it('keeps every device that has no key at all', () => {
        const devices = [{ mac: 'a' }, { mac: 'b' }];

        expect(deduplicateDevices(devices)).toHaveLength(2);
    });
});

describe('CloudMqttClient.connect()', () => {
    it('connects over TLS on the cloud port with the account credentials', async () => {
        const { connectOptions } = await connected();

        expect(connectOptions.url).toBe(`mqtts://mqtt-eu.gree.com:${DEFAULT_PORT}`);
        expect(DEFAULT_PORT).toBe(1984);
        expect(connectOptions.options).toMatchObject({
            username: '42',
            password: 'tok',
            protocolVersion: 4,
            clean: true,
            keepalive: 60,
            reconnectPeriod: 0,
        });
    });

    it('uses the token verbatim as the password', async () => {
        const { connectOptions } = await connected();

        // Hashing the token is rejected by the broker.
        expect(connectOptions.options.password).toBe('tok');
    });

    it('reports an expired session when the broker rejects the credentials', async () => {
        const { client, fake } = buildClient();
        const promise = client.connect();
        const error = new Error('Connection refused: Bad user name or password');
        error.code = 4;
        fake.emit('error', error);

        await expect(promise).rejects.toMatchObject({ reason: ERROR.SESSION_EXPIRED });
    });

    it('reports a network failure for any other connection error', async () => {
        const { client, fake } = buildClient();
        const promise = client.connect();
        fake.emit('error', new Error('ETIMEDOUT'));

        await expect(promise).rejects.toMatchObject({ reason: ERROR.NETWORK });
    });

    it('is idempotent', async () => {
        const { client } = await connected();

        await expect(client.connect()).resolves.toBeUndefined();
    });
});

describe('CloudMqttClient device routing', () => {
    it('subscribes to the response and status topics of the parent MAC', async () => {
        const { client, fake } = await connected();
        await client.attachDevice({ mac: 'c03937a616ab00', key: DEVICE_KEY });

        // connect/<mac> is deliberately left out: its encryption is unknown.
        expect(fake.subscribed).toEqual([[
            'response/c03937a616ab/#',
            'status/c03937a616ab/#',
        ]]);
    });

    it('subscribes to a parent topic only once', async () => {
        const { client, fake } = await connected();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY });
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY });

        expect(fake.subscribed).toHaveLength(1);
    });

    it('counts and releases attached devices', async () => {
        const { client } = await connected();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY });
        expect(client.deviceCount).toBe(1);

        client.detachDevice(MAC);
        expect(client.deviceCount).toBe(0);
    });
});

describe('CloudMqttClient.getStatus()', () => {
    it('publishes an encrypted status request addressed to the child MAC', async () => {
        const { client, fake } = await connected();
        await client.attachDevice({ mac: 'c03937a616ab00', key: DEVICE_KEY });

        const promise = client.getStatus('c03937a616ab00', ['Pow', 'Mod']);
        const [published] = fake.published;

        expect(published.topic).toBe('request/c03937a616ab');
        expect(published.message).toMatchObject({
            t: 'pack', tcid: 'c03937a616ab00', uid: 42,
        });
        expect(new CloudCipher(DEVICE_KEY).decrypt(published.message.pack))
            .toEqual({ t: 'status', cols: ['Pow', 'Mod'] });

        fake.emit('message', 'response/c03937a616ab/c03937a616ab00', deviceReply(
            {
                r: 200, t: 'dat', cols: ['Pow', 'Mod'], dat: [1, 4],
            },
            { cid: published.message.cid, tcid: 'c03937a616ab00' },
        ));

        await expect(promise).resolves.toEqual({ cols: ['Pow', 'Mod'], dat: [1, 4] });
    });

    it('correlates replies by cid so concurrent requests do not cross', async () => {
        const { client, fake } = await connected();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY });

        const first = client.getStatus(MAC, ['Pow']);
        const second = client.getStatus(MAC, ['Mod']);
        const [a, b] = fake.published;

        expect(a.message.cid).not.toBe(b.message.cid);

        fake.emit('message', `response/${MAC}/x`, deviceReply(
            { r: 200, cols: ['Mod'], dat: [4] }, { cid: b.message.cid },
        ));
        fake.emit('message', `response/${MAC}/x`, deviceReply(
            { r: 200, cols: ['Pow'], dat: [1] }, { cid: a.message.cid },
        ));

        await expect(first).resolves.toEqual({ cols: ['Pow'], dat: [1] });
        await expect(second).resolves.toEqual({ cols: ['Mod'], dat: [4] });
    });

    it('rejects when the device does not reply in time', async () => {
        const { client, fake } = await connected();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY });

        await expect(client.getStatus(MAC, ['Pow']))
            .rejects.toMatchObject({ reason: ERROR.NETWORK });
        expect(fake.published).toHaveLength(1);
    });

    it('rejects when the device reports a non-200 result', async () => {
        const { client, fake } = await connected();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY });

        const promise = client.getStatus(MAC, ['Pow']);
        fake.emit('message', `response/${MAC}/x`, deviceReply(
            { r: 500 }, { cid: fake.published[0].message.cid },
        ));

        await expect(promise).rejects.toMatchObject({ reason: ERROR.CLOUD });
    });

    it('rejects for a device that is not attached', async () => {
        const { client } = await connected();

        await expect(client.getStatus('nope', ['Pow']))
            .rejects.toMatchObject({ reason: ERROR.CLOUD });
    });

    it('rejects when the connection is not open', async () => {
        const { client } = buildClient();

        await expect(client.getStatus(MAC, ['Pow']))
            .rejects.toMatchObject({ reason: ERROR.NETWORK });
    });

    it('rejects when publishing fails', async () => {
        const { client, fake } = await connected();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY });
        fake.publishError = new Error('offline');

        await expect(client.getStatus(MAC, ['Pow']))
            .rejects.toMatchObject({ reason: ERROR.NETWORK });
    });
});

describe('CloudMqttClient.setProperties()', () => {
    it('publishes a command as parallel opt and p arrays', async () => {
        const { client, fake } = await connected();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY });

        const promise = client.setProperties(MAC, { Mod: 4, SetTem: 22 });
        const [published] = fake.published;

        expect(new CloudCipher(DEVICE_KEY).decrypt(published.message.pack))
            .toEqual({ t: 'cmd', opt: ['Mod', 'SetTem'], p: [4, 22] });

        fake.emit('message', `response/${MAC}/x`, deviceReply(
            {
                r: 200, t: 'res', opt: ['Mod', 'SetTem'], p: [4, 22],
            },
            { cid: published.message.cid },
        ));

        await expect(promise).resolves.toEqual({ opt: ['Mod', 'SetTem'], p: [4, 22] });
    });

    it('accepts a confirmation that uses val instead of p', async () => {
        const { client, fake } = await connected();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY });

        const promise = client.setProperties(MAC, { Pow: 1 });
        fake.emit('message', `response/${MAC}/x`, deviceReply(
            {
                r: 200, t: 'res', opt: ['Pow'], val: [1],
            },
            { cid: fake.published[0].message.cid },
        ));

        await expect(promise).resolves.toEqual({ opt: ['Pow'], p: [1] });
    });
});

describe('CloudMqttClient unsolicited messages', () => {
    it('hands a status push to the device it belongs to', async () => {
        const { client, fake } = await connected();
        const onProperties = jest.fn();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY, onProperties });

        fake.emit('message', `status/${MAC}/x`, deviceReply({
            t: 'dat', cols: ['Pow', 'SetTem'], dat: [1, 21],
        }));

        expect(onProperties).toHaveBeenCalledWith(['Pow', 'SetTem'], [1, 21]);
    });

    it('routes by tcid when several devices share a gateway', async () => {
        const { client, fake } = await connected();
        const first = jest.fn();
        const second = jest.fn();
        await client.attachDevice({ mac: 'aabbccddeeff00', key: DEVICE_KEY, onProperties: first });
        await client.attachDevice({ mac: 'aabbccddeeff01', key: DEVICE_KEY, onProperties: second });

        fake.emit('message', 'status/aabbccddeeff/x', deviceReply(
            { cols: ['Pow'], dat: [1] }, { tcid: 'aabbccddeeff01' },
        ));

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith(['Pow'], [1]);
    });

    it('ignores a message for a device it does not manage', async () => {
        const { client, fake } = await connected();
        const onProperties = jest.fn();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY, onProperties });

        fake.emit('message', 'status/someoneelse/x', deviceReply({ cols: ['Pow'], dat: [1] }));

        expect(onProperties).not.toHaveBeenCalled();
    });

    it('ignores unparsable and undecryptable messages', async () => {
        const { client, fake } = await connected();
        const onProperties = jest.fn();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY, onProperties });

        expect(() => {
            fake.emit('message', `status/${MAC}/x`, Buffer.from('not json'));
            fake.emit('message', `status/${MAC}/x`, Buffer.from(JSON.stringify({ pack: 'garbage' })));
            fake.emit('message', `status/${MAC}/x`, Buffer.from(JSON.stringify({ nope: true })));
        }).not.toThrow();

        expect(onProperties).not.toHaveBeenCalled();
    });
});

describe('CloudMqttClient.disconnect()', () => {
    it('ends the client, drops devices and rejects pending requests', async () => {
        const { client, fake } = await connected();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY });
        const pending = client.getStatus(MAC, ['Pow']);

        client.disconnect();

        await expect(pending).rejects.toMatchObject({ reason: ERROR.NETWORK });
        expect(fake.ended).toBe(true);
        expect(client.deviceCount).toBe(0);
        expect(client.connected).toBe(false);
    });

    it('keeps an error sink on the discarded client', async () => {
        const { client, fake } = await connected();
        client.disconnect();

        // Without a listener, Node would rethrow this as an uncaught exception.
        expect(() => fake.emit('error', new Error('late failure'))).not.toThrow();
    });

    it('rejects pending requests when the broker closes the connection', async () => {
        const { client, fake } = await connected();
        await client.attachDevice({ mac: MAC, key: DEVICE_KEY });
        const pending = client.getStatus(MAC, ['Pow']);

        fake.emit('close');

        await expect(pending).rejects.toMatchObject({ reason: ERROR.NETWORK });
    });
});
