'use strict';

const crypto = require('crypto');
const { EcbCipher, GcmCipher } = require('gree-hvac-client/src/encryption-service');

/**
 * The Gree cloud speaks the same two AES flavours as the local UDP protocol, so
 * the ciphers from `gree-hvac-client` are reused as-is:
 *
 * - the REST envelope is AES-128-ECB with a single global app key,
 * - the MQTT `pack` payload is AES-128-ECB with a per-device key ("CipherV1"),
 * - "CipherV2" is AES-128-GCM with the very same nonce and AAD that
 *   `GcmCipher` already implements.
 *
 * Only the padding of incoming messages differs: some firmwares pad the
 * plaintext with bytes that are not valid PKCS#7, which makes OpenSSL reject
 * the final block. `decrypt()` falls back to reading such messages without
 * padding validation.
 */

// AES key the Gree cloud uses for the REST request/response envelope. It is
// embedded in the vendor app and identical for every installation.
const CLOUD_AES_KEY = '#G$&^jgfujy6ujxt';

/**
 * Decrypt an AES-128-ECB payload that may carry padding OpenSSL rejects.
 *
 * @param {string} pack Base64 ciphertext
 * @param {string} key AES key
 * @returns {object} Parsed JSON payload
 * @private
 */
function decryptEcbWithoutPadding(pack, key) {
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    decipher.setAutoPadding(false);

    const raw = Buffer.concat([
        decipher.update(pack, 'base64'),
        decipher.final(),
    ]).toString('utf8');

    // Everything after the outermost closing brace is padding, not payload.
    const end = raw.lastIndexOf('}');
    if (end === -1) {
        throw new Error('Decrypted payload is not a JSON object');
    }

    return JSON.parse(raw.slice(0, end + 1));
}

class CloudCipher {

    /**
     * @param {string} key AES key. Defaults to the global cloud key used by the
     *                     REST API; pass a device key for MQTT `pack` payloads.
     * @param {boolean} [gcm] Use AES-128-GCM ("CipherV2") instead of ECB
     */
    constructor(key = CLOUD_AES_KEY, gcm = false) {
        this._key = key;
        this._cipher = gcm ? new GcmCipher(key) : new EcbCipher(key);
        this._gcm = gcm;
    }

    /**
     * Encrypt a payload.
     *
     * @param {object} payload
     * @returns {{pack: string, tag: string|undefined}}
     */
    encrypt(payload) {
        const encrypted = this._cipher.encrypt(payload);

        return { pack: encrypted.payload, tag: encrypted.tag };
    }

    /**
     * Decrypt a payload, tolerating non-PKCS#7 padding on ECB messages.
     *
     * @param {string} pack Base64 ciphertext
     * @param {string} [tag] Base64 GCM authentication tag
     * @returns {object} Parsed JSON payload
     */
    decrypt(pack, tag) {
        try {
            return this._cipher.decrypt({ pack, tag }).payload;
        } catch (error) {
            if (this._gcm) {
                // GCM is authenticated: a failure means the message is not ours.
                throw error;
            }

            return decryptEcbWithoutPadding(pack, this._key);
        }
    }

}

/**
 * @param {string} value
 * @returns {string} Lowercase hex MD5 digest
 */
function md5(value) {
    return crypto.createHash('md5').update(value, 'utf8').digest('hex');
}

module.exports = {
    CloudCipher,
    CLOUD_AES_KEY,
    md5,
};
