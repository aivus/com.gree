'use strict';

const crypto = require('crypto');
const {
    CloudRestClient, REGIONS, REGION_IDS, formatTimestamp, APP_ID, APP_HASH,
} = require('../drivers/gree_cloud_hvac/network/rest');
const { ERROR } = require('../drivers/gree_cloud_hvac/network/errors');
const { CloudCipher } = require('../drivers/gree_cloud_hvac/network/crypto');

const FIXED_DATE = new Date('2026-08-28T10:20:30.000Z');
const cipher = new CloudCipher();

function md5(value) {
    return crypto.createHash('md5').update(value, 'utf8').digest('hex');
}

/**
 * Build a fetch stub that captures requests and replies with encrypted payloads.
 *
 * @param {object[]} responses Payloads to return, in order
 * @returns {Function}
 */
function stubFetch(responses) {
    const queue = [...responses];
    const calls = [];

    const fetchImpl = async (url, options) => {
        calls.push({ url, options, body: cipher.decrypt(options.body) });

        const next = queue.shift();
        if (next instanceof Error) {
            throw next;
        }

        return {
            ok: next.ok !== false,
            status: next.status || 200,
            json: async () => (
                'envelope' in next ? next.envelope : { enRes: cipher.encrypt(next).pack }
            ),
        };
    };

    fetchImpl.calls = calls;
    return fetchImpl;
}

function client(fetchImpl, region = 'europe') {
    return new CloudRestClient({
        region, fetch: fetchImpl, now: () => FIXED_DATE,
    });
}

describe('CloudRestClient regions', () => {
    it('exposes one base URL per region id', () => {
        expect(REGION_IDS).toHaveLength(10);
        expect(Object.values(REGIONS).every((url) => url.startsWith('https://'))).toBe(true);
    });

    it('rejects an unknown region', () => {
        expect(() => new CloudRestClient({ region: 'atlantis' })).toThrow(/Unknown Gree cloud region/);
    });

    it('uses the bare host for China Mainland and a prefix elsewhere', () => {
        expect(REGIONS.china).toBe('https://grih.gree.com');
        expect(REGIONS.europe).toBe('https://eugrih.gree.com');
    });
});

describe('formatTimestamp', () => {
    it('formats a date as UTC "YYYY-MM-DD HH:MM:SS"', () => {
        expect(formatTimestamp(FIXED_DATE)).toBe('2026-08-28 10:20:30');
    });
});

describe('CloudRestClient.login()', () => {
    it('signs the request and hashes the password with the request timestamp', async () => {
        const fetchImpl = stubFetch([{ uid: 42, token: 'tok' }]);

        await expect(client(fetchImpl).login('user@example.com', 'secret'))
            .resolves.toEqual({ uid: 42, token: 'tok' });

        const [call] = fetchImpl.calls;
        const t = '2026-08-28 10:20:30';
        const r = Math.floor(FIXED_DATE.getTime() / 1000);

        expect(call.url).toBe('https://eugrih.gree.com/App/UserLoginV2');
        expect(call.body.api).toEqual({
            appId: APP_ID,
            r,
            t,
            vc: md5(`${APP_ID}_${APP_HASH}_${t}_${r}`),
        });

        // The password is hashed twice, the second time with the same timestamp
        // that signs the request.
        const expectedPsw = md5(md5(`${md5('secret')}secret`) + t);
        expect(call.body.psw).toBe(expectedPsw);
        expect(call.body.user).toBe('user@example.com');

        // datVc covers user, psw and t - in that order.
        expect(call.body.datVc).toBe(md5(`${APP_HASH}_user@example.com_${expectedPsw}_${t}`));
    });

    it('never sends the plaintext password', async () => {
        const fetchImpl = stubFetch([{ uid: 1, token: 'tok' }]);
        await client(fetchImpl).login('user@example.com', 'secret');

        expect(JSON.stringify(fetchImpl.calls[0].body)).not.toContain('secret');
    });

    it('sends the static headers the cloud requires', async () => {
        const fetchImpl = stubFetch([{ uid: 1, token: 'tok' }]);
        await client(fetchImpl).login('user@example.com', 'secret');

        expect(fetchImpl.calls[0].options.headers).toEqual({
            'Content-Type': 'application/x-www-form-urlencoded',
            Gaen1: '5ac2bdf935bcca70',
            Charset: 'utf-8',
        });
    });

    it('reports invalid credentials when the cloud rejects the sign-in', async () => {
        const fetchImpl = stubFetch([{ r: 404, msg: 'user not exist' }]);

        await expect(client(fetchImpl).login('user@example.com', 'nope'))
            .rejects.toMatchObject({ reason: ERROR.INVALID_CREDENTIALS });
    });

    it('reports invalid credentials when no token comes back', async () => {
        const fetchImpl = stubFetch([{ uid: 1 }]);

        await expect(client(fetchImpl).login('user@example.com', 'secret'))
            .rejects.toMatchObject({ reason: ERROR.INVALID_CREDENTIALS });
    });

    it('reports a network failure when the request throws', async () => {
        const fetchImpl = stubFetch([new Error('ENOTFOUND')]);

        await expect(client(fetchImpl).login('user@example.com', 'secret'))
            .rejects.toMatchObject({ reason: ERROR.NETWORK });
    });

    it('reports rate limiting on HTTP 429', async () => {
        const fetchImpl = stubFetch([{ ok: false, status: 429 }]);

        await expect(client(fetchImpl).login('user@example.com', 'secret'))
            .rejects.toMatchObject({ reason: ERROR.RATE_LIMITED });
    });

    it('reports a cloud failure when the envelope carries no payload', async () => {
        const fetchImpl = stubFetch([{ envelope: { nope: true } }]);

        await expect(client(fetchImpl).login('user@example.com', 'secret'))
            .rejects.toMatchObject({ reason: ERROR.CLOUD });
    });
});

describe('CloudRestClient.getHomes()', () => {
    const account = { uid: 42, token: 'tok' };

    it('returns the homes and signs with token then uid', async () => {
        const fetchImpl = stubFetch([{ home: [{ id: 7, name: 'Home' }] }]);

        await expect(client(fetchImpl).getHomes(account))
            .resolves.toEqual([{ id: 7, name: 'Home' }]);

        expect(fetchImpl.calls[0].body.datVc).toBe(md5(`${APP_HASH}_tok_42`));
    });

    it('returns an empty list when the account has no homes', async () => {
        const fetchImpl = stubFetch([{}]);

        await expect(client(fetchImpl).getHomes(account)).resolves.toEqual([]);
    });

    it('reports an expired session on HTTP-level 401 in the payload', async () => {
        const fetchImpl = stubFetch([{ r: 401, msg: 'token invalid' }]);

        await expect(client(fetchImpl).getHomes(account))
            .rejects.toMatchObject({ reason: ERROR.SESSION_EXPIRED });
    });
});

describe('CloudRestClient.getDevices()', () => {
    const account = { uid: 42, token: 'tok' };

    it('flattens the devices of every room', async () => {
        const fetchImpl = stubFetch([{
            rooms: [
                { devs: [{ mac: 'aabb', name: 'One' }] },
                { devs: [{ mac: 'ccdd', name: 'Two' }] },
                { devs: [] },
                {},
            ],
        }]);

        await expect(client(fetchImpl).getDevices(account, 7)).resolves.toEqual([
            { mac: 'aabb', name: 'One' },
            { mac: 'ccdd', name: 'Two' },
        ]);
    });

    it('signs with token, uid and homeId in that order', async () => {
        const fetchImpl = stubFetch([{ rooms: [] }]);
        await client(fetchImpl).getDevices(account, 7);

        // The signature order differs from the payload order.
        expect(fetchImpl.calls[0].body.datVc).toBe(md5(`${APP_HASH}_tok_42_7`));
    });
});

describe('CloudRestClient.getMqttAddress()', () => {
    const account = { uid: 42, token: 'tok' };

    it('parses the broker host and port', async () => {
        const fetchImpl = stubFetch([{
            r: 200, data: { connections: [{ url: 'ssl://mqtt-eu.gree.com:1984' }] },
        }]);

        await expect(client(fetchImpl).getMqttAddress(account))
            .resolves.toEqual({ host: 'mqtt-eu.gree.com', port: 1984 });
    });

    it('fails when the address cannot be parsed', async () => {
        const fetchImpl = stubFetch([{ r: 200, data: { connections: [{ url: 'tcp://nope' }] } }]);

        await expect(client(fetchImpl).getMqttAddress(account))
            .rejects.toMatchObject({ reason: ERROR.CLOUD });
    });

    it('fails when no connection is offered', async () => {
        const fetchImpl = stubFetch([{ r: 200, data: {} }]);

        await expect(client(fetchImpl).getMqttAddress(account))
            .rejects.toMatchObject({ reason: ERROR.CLOUD });
    });
});
