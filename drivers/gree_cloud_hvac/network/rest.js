'use strict';

const { CloudCipher, md5 } = require('./crypto');
const { CloudError, ERROR } = require('./errors');

/**
 * Minimal client for the Gree cloud REST API.
 *
 * The API is not documented or sanctioned by Gree; the constants below are
 * embedded in the vendor apps and are identical for every installation. Every
 * request body is AES encrypted (see CloudCipher) and signed with two MD5
 * digests, and every response arrives encrypted in an `enRes` field.
 *
 * The REST API is only used to sign in, list devices and look up the MQTT
 * broker. Reading and writing device state happens over MQTT.
 */

const APP_ID = '4920681951525131286';
const APP_HASH = '0fa513124aa97781d1f3f40d61ca1a89';

// Static header the API expects on every request.
const GAEN1 = '5ac2bdf935bcca70';

const DEFAULT_REQUEST_TIMEOUT = 15000;

/**
 * REST base URL per account region. The region is chosen when the Gree account
 * is created and a request to the wrong region always fails to authenticate.
 */
const REGIONS = {
    australia: 'https://augrih.gree.com',
    china: 'https://grih.gree.com',
    east_south_asia: 'https://hkgrih.gree.com',
    europe: 'https://eugrih.gree.com',
    india: 'https://ingrih.gree.com',
    latin_america: 'https://lagrih.gree.com',
    middle_east: 'https://megrih.gree.com',
    north_america: 'https://nagrih.gree.com',
    russia: 'https://rugrih.gree.com',
    south_america: 'https://sagrih.gree.com',
};

const REGION_IDS = Object.keys(REGIONS);

/**
 * The API timestamp format: UTC "YYYY-MM-DD HH:MM:SS".
 *
 * @param {Date} date
 * @returns {string}
 */
function formatTimestamp(date) {
    return date.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Map an API status code onto an error reason.
 *
 * @param {number} code
 * @returns {string}
 * @private
 */
function reasonForCode(code) {
    if (code === 401 || code === 403) {
        return ERROR.SESSION_EXPIRED;
    }

    if (code === 429) {
        return ERROR.RATE_LIMITED;
    }

    return ERROR.CLOUD;
}

class CloudRestClient {

    /**
     * @param {object} options
     * @param {string} options.region One of REGION_IDS
     * @param {number} [options.timeout] Request timeout in ms
     * @param {Function} [options.fetch] Fetch implementation (for tests)
     * @param {Function} [options.now] Clock returning a Date (for tests)
     */
    constructor({
        region, timeout = DEFAULT_REQUEST_TIMEOUT, fetch: fetchImpl, now,
    }) {
        if (!REGIONS[region]) {
            throw new Error(`Unknown Gree cloud region: ${region}`);
        }

        this._baseUrl = REGIONS[region];
        this._region = region;
        this._timeout = timeout;
        this._fetch = fetchImpl || ((...args) => fetch(...args));
        this._now = now || (() => new Date());
        this._cipher = new CloudCipher();
    }

    get region() {
        return this._region;
    }

    /**
     * Sign in and return the account credentials used by every other call.
     *
     * @param {string} username Account e-mail address
     * @param {string} password Account password
     * @returns {Promise<{uid: number, token: string}>}
     */
    async login(username, password) {
        // The password is hashed twice, the second time together with the very
        // same timestamp that signs the request, so it must be generated once
        // and shared - deriving it twice can straddle a second boundary and
        // produce a signature the API rejects.
        const timestamp = formatTimestamp(this._now());
        const hashed = md5(md5(password) + password);

        const response = await this._request('/App/UserLoginV2', {
            payload: {
                psw: md5(hashed + timestamp),
                t: timestamp,
                user: username,
            },
            hashProps: ['user', 'psw', 't'],
            timestamp,
        });

        if (!response.token || response.uid === undefined) {
            throw new CloudError(ERROR.INVALID_CREDENTIALS, 'Sign-in response carried no token');
        }

        return { uid: response.uid, token: response.token };
    }

    /**
     * List the homes the account has access to.
     *
     * @param {{uid: number, token: string}} account
     * @returns {Promise<Array<{id: number, name: string}>>}
     */
    async getHomes({ uid, token }) {
        const response = await this._request('/App/GetHomes', {
            payload: { token, uid },
            hashProps: ['token', 'uid'],
        });

        return response.home || [];
    }

    /**
     * List the devices in every room of a home.
     *
     * @param {{uid: number, token: string}} account
     * @param {number} homeId
     * @returns {Promise<Array<object>>} Raw device objects
     */
    async getDevices({ uid, token }, homeId) {
        const response = await this._request('/App/GetDevsInRoomsOfHomeV2', {
            // Note the hash order differs from the payload order.
            payload: { token, homeId, uid },
            hashProps: ['token', 'uid', 'homeId'],
        });

        return (response.rooms || []).flatMap((room) => room.devs || []);
    }

    /**
     * Look up the MQTT broker for this account.
     *
     * The broker hostname must not be hard-coded: the vendor has moved it
     * between releases and stale tables resolve to hosts that no longer exist.
     *
     * @param {{uid: number, token: string}} account
     * @returns {Promise<{host: string, port: number}>}
     */
    async getMqttAddress({ uid, token }) {
        const response = await this._request('/shadow/api/getAddressV3?ssl=true', {
            payload: { token, uid },
            hashProps: ['token', 'uid'],
        });

        const url = response.data && response.data.connections && response.data.connections[0]
            ? response.data.connections[0].url
            : undefined;

        const parsed = /^ssl:\/\/([^:/]+):(\d+)$/.exec(url || '');
        if (!parsed) {
            throw new CloudError(ERROR.CLOUD, 'Broker address response could not be parsed');
        }

        return { host: parsed[1], port: Number(parsed[2]) };
    }

    /**
     * Build, sign, encrypt and send a request, then decrypt the response.
     *
     * @param {string} endpoint
     * @param {object} options
     * @param {object} options.payload Endpoint specific fields
     * @param {string[]} options.hashProps Payload keys, in the order the
     *        signature expects them - the order is part of the signature
     * @param {string} [options.timestamp] Reuse an already generated timestamp
     * @returns {Promise<object>} Decrypted response payload
     * @private
     */
    async _request(endpoint, { payload, hashProps, timestamp }) {
        const now = this._now();
        const t = timestamp || formatTimestamp(now);
        const r = Math.floor(now.getTime() / 1000);

        const body = {
            api: {
                appId: APP_ID,
                r,
                t,
                vc: md5(`${APP_ID}_${APP_HASH}_${t}_${r}`),
            },
            datVc: md5(`${APP_HASH}_${hashProps.map((key) => String(payload[key])).join('_')}`),
            ...payload,
        };

        const raw = await this._send(endpoint, this._cipher.encrypt(body).pack);

        let decrypted;
        try {
            decrypted = this._cipher.decrypt(raw.enRes);
        } catch (error) {
            throw new CloudError(ERROR.CLOUD, `Response could not be decrypted: ${error.message}`);
        }

        // A successful call either omits `r` or reports 200.
        if (decrypted.r !== undefined && decrypted.r !== 200) {
            const reason = endpoint === '/App/UserLoginV2'
                ? ERROR.INVALID_CREDENTIALS
                : reasonForCode(decrypted.r);

            throw new CloudError(reason, `Cloud returned ${decrypted.r}: ${decrypted.msg || 'no message'}`);
        }

        return decrypted;
    }

    /**
     * POST an encrypted body and return the parsed envelope.
     *
     * @param {string} endpoint
     * @param {string} pack Encrypted, base64 encoded body
     * @returns {Promise<{enRes: string}>}
     * @private
     */
    async _send(endpoint, pack) {
        const controller = new AbortController();
        const timeoutRef = setTimeout(() => controller.abort(), this._timeout);

        let response;
        try {
            response = await this._fetch(`${this._baseUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    // The body is a raw encrypted string despite this header,
                    // which is what the vendor app sends.
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Gaen1: GAEN1,
                    Charset: 'utf-8',
                },
                body: pack,
                signal: controller.signal,
            });
        } catch (error) {
            throw new CloudError(ERROR.NETWORK, `Request to ${endpoint} failed: ${error.message}`);
        } finally {
            clearTimeout(timeoutRef);
        }

        if (response.status === 429) {
            throw new CloudError(ERROR.RATE_LIMITED, `Cloud rate limited ${endpoint}`);
        }

        if (!response.ok) {
            throw new CloudError(ERROR.NETWORK, `Cloud returned HTTP ${response.status} for ${endpoint}`);
        }

        let envelope;
        try {
            envelope = await response.json();
        } catch (error) {
            throw new CloudError(ERROR.CLOUD, `Response to ${endpoint} was not JSON`);
        }

        if (!envelope || typeof envelope.enRes !== 'string') {
            throw new CloudError(ERROR.CLOUD, `Response to ${endpoint} carried no payload`);
        }

        return envelope;
    }

}

module.exports = {
    CloudRestClient,
    REGIONS,
    REGION_IDS,
    formatTimestamp,
    APP_ID,
    APP_HASH,
};
