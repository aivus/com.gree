'use strict';

const session = require('../drivers/gree_cloud_hvac/network/session');

const { CloudSession, accountKey } = session;

/**
 * Build a session with a stubbed connection factory.
 *
 * @returns {object}
 */
function build() {
    const created = [];

    const instance = new CloudSession();
    instance.setConnectionFactory((options) => {
        const connection = {
            options,
            authenticate: jest.fn(async () => ({ uid: 42, token: 'tok' })),
            listDevices: jest.fn(async () => [{ mac: 'aabb', key: 'k' }]),
            stop: jest.fn(),
        };
        created.push(connection);
        return connection;
    });

    return { instance, created };
}

describe('accountKey()', () => {
    it('is case insensitive and trims the address', () => {
        expect(accountKey('europe', '  User@Example.COM ')).toBe('europe:user@example.com');
    });

    it('keeps regions in separate namespaces', () => {
        // The same address can legitimately exist in two regions.
        expect(accountKey('europe', 'a@b.c')).not.toBe(accountKey('china', 'a@b.c'));
    });
});

describe('CloudSession.getConnection()', () => {
    it('creates one connection per account', () => {
        const { instance, created } = build();

        instance.getConnection({ region: 'europe', username: 'a@b.c', password: 'p' });
        instance.getConnection({ region: 'europe', username: 'a@b.c', password: 'p' });

        // A Gree account allows a single session, so devices must share one.
        expect(created).toHaveLength(1);
        expect(instance.size).toBe(1);
    });

    it('treats the same address in another region as another account', () => {
        const { instance, created } = build();

        instance.getConnection({ region: 'europe', username: 'a@b.c', password: 'p' });
        instance.getConnection({ region: 'china', username: 'a@b.c', password: 'p' });

        expect(created).toHaveLength(2);
    });

    it('passes the stored token and callbacks through', () => {
        const { instance, created } = build();
        const onAccountChange = jest.fn();

        instance.getConnection({
            region: 'europe',
            username: 'a@b.c',
            password: 'p',
            account: { uid: 1, token: 'stored' },
            onAccountChange,
        });

        expect(created[0].options).toMatchObject({
            region: 'europe',
            username: 'a@b.c',
            password: 'p',
            account: { uid: 1, token: 'stored' },
            onAccountChange,
        });
    });
});

describe('CloudSession.signIn()', () => {
    it('signs in with the given credentials and lists the devices', async () => {
        const { instance, created } = build();

        await expect(instance.signIn({ region: 'europe', username: 'a@b.c', password: 'p' }))
            .resolves.toEqual({
                account: { uid: 42, token: 'tok' },
                devices: [{ mac: 'aabb', key: 'k' }],
            });

        // Forced, because the point is to validate what the user just typed.
        expect(created[0].authenticate).toHaveBeenCalledWith(true);
    });

    it('does not register or reuse a cached connection', async () => {
        const { instance, created } = build();
        instance.getConnection({ region: 'europe', username: 'a@b.c', password: 'old' });

        await instance.signIn({ region: 'europe', username: 'a@b.c', password: 'new' });

        expect(created).toHaveLength(2);
        expect(instance.size).toBe(1);
    });

    it('releases the throwaway connection', async () => {
        const { instance, created } = build();
        await instance.signIn({ region: 'europe', username: 'a@b.c', password: 'p' });

        expect(created[0].stop).toHaveBeenCalled();
    });

    it('propagates a sign-in failure', async () => {
        const { instance, created } = build();
        await instance.signIn({ region: 'europe', username: 'a@b.c', password: 'p' });
        created[0].authenticate.mockRejectedValue(new Error('nope'));

        instance.setConnectionFactory(() => created[0]);
        await expect(instance.signIn({ region: 'europe', username: 'a@b.c', password: 'p' }))
            .rejects.toThrow('nope');
    });
});

describe('CloudSession.release()', () => {
    it('closes and forgets the account', () => {
        const { instance, created } = build();
        instance.getConnection({ region: 'europe', username: 'a@b.c', password: 'p' });

        instance.release('europe', 'a@b.c');

        expect(created[0].stop).toHaveBeenCalled();
        expect(instance.size).toBe(0);
    });

    it('ignores an account it does not know', () => {
        const { instance } = build();

        expect(() => instance.release('europe', 'nobody@example.com')).not.toThrow();
    });
});

describe('CloudSession.stop()', () => {
    it('closes every connection', () => {
        const { instance, created } = build();
        instance.getConnection({ region: 'europe', username: 'a@b.c', password: 'p' });
        instance.getConnection({ region: 'china', username: 'd@e.f', password: 'p' });

        instance.stop();

        created.forEach((connection) => expect(connection.stop).toHaveBeenCalled());
        expect(instance.size).toBe(0);
    });

    it('keeps closing the rest when one connection throws', () => {
        const { instance, created } = build();
        instance.getConnection({ region: 'europe', username: 'a@b.c', password: 'p' });
        instance.getConnection({ region: 'china', username: 'd@e.f', password: 'p' });
        created[0].stop.mockImplementation(() => {
            throw new Error('already gone');
        });

        expect(() => instance.stop()).not.toThrow();
        expect(created[1].stop).toHaveBeenCalled();
        expect(instance.size).toBe(0);
    });
});

describe('the shared session module', () => {
    it('exports a single ready-to-use instance', () => {
        expect(session).toBeInstanceOf(CloudSession);
    });

    it('starts nothing on require', () => {
        // Unlike the local driver's finder, which binds a UDP socket at once.
        expect(session.size).toBe(0);
    });
});
