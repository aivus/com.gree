'use strict';

const crypto = require('crypto');
const { CloudCipher, CLOUD_AES_KEY, md5 } = require('../drivers/gree_cloud_hvac/network/crypto');

const DEVICE_KEY = 'vyJb0KU05QjdCiZm';

describe('CloudCipher', () => {
    it('uses a 16 byte global cloud key', () => {
        expect(Buffer.from(CLOUD_AES_KEY, 'utf8')).toHaveLength(16);
    });

    it('round-trips a REST envelope with the global key', () => {
        const cipher = new CloudCipher();
        const payload = { api: { appId: '1' }, datVc: 'abc', user: 'user@example.com' };

        expect(cipher.decrypt(cipher.encrypt(payload).pack)).toEqual(payload);
    });

    it('round-trips an MQTT pack with a device key', () => {
        const cipher = new CloudCipher(DEVICE_KEY);
        const payload = { t: 'cmd', opt: ['Pow', 'Mod'], p: [1, 4] };

        expect(cipher.decrypt(cipher.encrypt(payload).pack)).toEqual(payload);
    });

    it('round-trips a GCM pack and carries the authentication tag', () => {
        const cipher = new CloudCipher(DEVICE_KEY, true);
        const payload = { t: 'status', cols: ['Pow', 'SetTem'] };
        const { pack, tag } = cipher.encrypt(payload);

        expect(typeof tag).toBe('string');
        expect(cipher.decrypt(pack, tag)).toEqual(payload);
    });

    it('decrypts an ECB payload whose padding is not valid PKCS#7', () => {
        const payload = {
            r: 200, t: 'dat', cols: ['Pow'], dat: [1],
        };
        const json = JSON.stringify(payload);

        // Some firmwares pad the plaintext with arbitrary bytes rather than
        // PKCS#7, which makes OpenSSL reject the final block outright.
        const padded = Buffer.alloc(Math.ceil(json.length / 16) * 16, 0x07);
        padded.write(json, 'utf8');

        const encipher = crypto.createCipheriv('aes-128-ecb', DEVICE_KEY, null);
        encipher.setAutoPadding(false);
        const pack = Buffer.concat([encipher.update(padded), encipher.final()]).toString('base64');

        expect(new CloudCipher(DEVICE_KEY).decrypt(pack)).toEqual(payload);
    });

    it('rejects a GCM payload with a bad authentication tag', () => {
        const cipher = new CloudCipher(DEVICE_KEY, true);
        const { pack } = cipher.encrypt({ t: 'status' });

        expect(() => cipher.decrypt(pack, Buffer.alloc(16).toString('base64'))).toThrow();
    });

    it('rejects ciphertext that does not decrypt to a JSON object', () => {
        expect(() => new CloudCipher(DEVICE_KEY).decrypt(
            new CloudCipher('0000000000000000').encrypt({ t: 'cmd' }).pack,
        )).toThrow();
    });
});

describe('md5', () => {
    it('returns a lowercase hex digest', () => {
        expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    });
});
