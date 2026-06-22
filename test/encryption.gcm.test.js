'use strict';

const {
    EncryptionService,
    GcmCipher,
} = require('gree-hvac-client/src/encryption-service');
const { createLogger } = require('gree-hvac-client/src/logger');

// A real scan ("dev") response captured from a Gree device running firmware
// V2.0.0, which encrypts with AES-128-GCM (note the `tag` field). Older
// firmware uses AES-128-ECB and has no tag.
const GCM_DEV_MESSAGE = {
    t: 'pack',
    i: 1,
    uid: 0,
    cid: '502cc66cd76a',
    tcid: '51d96e700597',
    tag: 'C5OIbVRLeXT6G7K6h+ZUTA==',
    pack:
        'JtoKliwtrZWlpNCVOSARFZVjvdMQgUTwNgcwCuyKhOTTdG5N10M5OI3w9aCGCJ'
        + 'ffjfuyCITofrMT4JbII6+A1+2Qyk7gfwk5dZR2EayhdZgEoOSGGofp1NG95s5quv'
        + '8eFq+2oChWDqTDGSfh0Qvsoz/uHnpJj7cgLseHEa1Qy49usnE8T0XpY+Ox/g0sCK'
        + '2y2vzlARuL1vKmpT7wkMRwPTuo1zE7mhrFvdLWdzI6Z6osCeD6tdJoLaE7k6FHvg'
        + 'hQKe+boL4=',
};

const logger = createLogger('error').child({ service: 'test' });

describe('GCM encryption support (patched gree-hvac-client)', () => {
    test('GcmCipher decrypts a V2.x device scan response', () => {
        const { payload } = new GcmCipher().decrypt(GCM_DEV_MESSAGE);

        expect(payload.t).toBe('dev');
        expect(payload.mac).toBe('502cc66cd76a');
        expect(payload.ver).toBe('V2.0.0');
    });

    test('EncryptionService auto-detects GCM even though it defaults to ECB', () => {
        // Regression guard for patches/gree-hvac-client+3.0.3.patch: the service
        // must fall back from the default ECB cipher to GCM, otherwise GCM
        // devices fail to decrypt with ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH and are
        // never discovered.
        const service = new EncryptionService(logger);

        const payload = service.decrypt(GCM_DEV_MESSAGE);

        expect(payload.t).toBe('dev');
        expect(payload.mac).toBe('502cc66cd76a');
    });
});
