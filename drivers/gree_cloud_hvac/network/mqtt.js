'use strict';

const { randomBytes, randomInt } = require('crypto');
const { CloudCipher } = require('./crypto');
const { CloudError, ERROR } = require('./errors');

/**
 * MQTT transport for the Gree cloud.
 *
 * All device state is read and written over a single TLS MQTT connection per
 * account. Each message carries an AES encrypted `pack` payload keyed with the
 * device's own key, which the REST API hands out at pair time.
 *
 * Devices are addressed by two MACs. Commercial and ducted units are exposed as
 * a child of a gateway: the topics use the *parent* MAC while the `tcid` field
 * names the child. For a plain split unit both are the same.
 */

// The broker speaks TLS on this port. It is deliberately not 8883.
const DEFAULT_PORT = 1984;

const DEFAULT_CONNECT_TIMEOUT = 30000;
const DEFAULT_REQUEST_TIMEOUT = 10000;

const KEEPALIVE_SECONDS = 60;

/**
 * Derive the topic (parent) and `tcid` (child) MAC for a device.
 *
 * A MAC longer than 12 characters that ends in "00" belongs to a child device;
 * its parent is the same MAC without those two trailing characters.
 *
 * @param {string} mac MAC as reported by the REST device list
 * @returns {{parentMac: string, childMac: string}}
 */
function resolveMacs(mac) {
    if (typeof mac === 'string' && mac.length > 12 && mac.endsWith('00')) {
        return { parentMac: mac.slice(0, -2), childMac: mac };
    }

    return { parentMac: mac, childMac: mac };
}

/**
 * The cloud hands out the same key twice for some ducted units, once for a MAC
 * ending in "00" and once for a twin that never answers commands. Keep only the
 * "00" variant when a key is duplicated.
 *
 * @param {Array<object>} devices Raw device objects from the REST device list
 * @returns {Array<object>}
 */
function deduplicateDevices(devices) {
    const byKey = new Map();

    devices.forEach((device) => {
        if (!device.key) {
            byKey.set(`nokey:${device.mac}`, device);
            return;
        }

        const existing = byKey.get(device.key);
        if (!existing) {
            byKey.set(device.key, device);
            return;
        }

        if (!String(existing.mac).endsWith('00') && String(device.mac).endsWith('00')) {
            byKey.set(device.key, device);
        }
    });

    return [...byKey.values()];
}

class CloudMqttClient {

    /**
     * @param {object} options
     * @param {string} options.host Broker hostname
     * @param {number} [options.port] Broker port
     * @param {number} options.uid Account id, used as the MQTT username
     * @param {string} options.token Account token, used as the MQTT password
     * @param {number} [options.connectTimeout]
     * @param {number} [options.requestTimeout]
     * @param {boolean} [options.rejectUnauthorized]
     * @param {object} [options.mqtt] mqtt module (for tests)
     * @param {object} [options.logger] Object with log()/error()
     */
    constructor({
        host,
        port = DEFAULT_PORT,
        uid,
        token,
        connectTimeout = DEFAULT_CONNECT_TIMEOUT,
        requestTimeout = DEFAULT_REQUEST_TIMEOUT,
        rejectUnauthorized = true,
        mqtt,
        logger,
    }) {
        this._host = host;
        this._port = port;
        this._uid = uid;
        this._token = token;
        this._connectTimeout = connectTimeout;
        this._requestTimeout = requestTimeout;
        this._rejectUnauthorized = rejectUnauthorized;
        // eslint-disable-next-line global-require
        this._mqtt = mqtt || require('mqtt');
        this._logger = logger || { log() {}, error() {} };

        this._client = null;

        /**
         * Devices attached to this connection, keyed by their reported MAC.
         *
         * @type {Map<string, {cipher: CloudCipher, parentMac: string, childMac: string, onProperties: Function}>}
         * @private
         */
        this._devices = new Map();

        /**
         * Requests awaiting a reply, keyed by the `cid` they were sent with.
         *
         * @type {Map<string, {resolve: Function, reject: Function, timeoutRef: NodeJS.Timeout}>}
         * @private
         */
        this._pending = new Map();

        /**
         * Topics already subscribed, so re-attaching a device is cheap.
         *
         * @type {Set<string>}
         * @private
         */
        this._subscribed = new Set();

        this._sequence = 0;
    }

    get connected() {
        return Boolean(this._client && this._client.connected);
    }

    /**
     * Open the connection. Resolves once the broker accepted the credentials.
     *
     * @returns {Promise<void>}
     */
    connect() {
        if (this._client) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const client = this._mqtt.connect(`mqtts://${this._host}:${this._port}`, {
                // The account id and token are used verbatim; hashing the token
                // is rejected by the broker.
                username: String(this._uid),
                password: this._token,
                clientId: `app_${randomBytes(8).toString('hex')}`,
                protocolVersion: 4,
                clean: true,
                keepalive: KEEPALIVE_SECONDS,
                connectTimeout: this._connectTimeout,
                rejectUnauthorized: this._rejectUnauthorized,
                reconnectPeriod: 0,
            });

            this._client = client;

            let settled = false;
            const settle = (error) => {
                if (settled) {
                    return;
                }
                settled = true;

                if (error) {
                    this._teardown();
                    reject(error);
                    return;
                }

                resolve();
            };

            client.on('connect', () => settle());

            client.on('error', (error) => {
                this._logger.error('[mqtt]', 'connection error:', error.message);
                settle(this._classifyError(error));
            });

            client.on('close', () => {
                this._logger.log('[mqtt]', 'connection closed');
                settle(new CloudError(ERROR.NETWORK, 'Broker closed the connection'));
                this._failPending(new CloudError(ERROR.NETWORK, 'Connection closed'));
            });

            client.on('message', (topic, payload) => this._onMessage(topic, payload));
        });
    }

    /**
     * Register a device so its replies are decrypted and routed.
     *
     * @param {object} device
     * @param {string} device.mac MAC as reported by the REST device list
     * @param {string} device.key Per-device AES key
     * @param {Function} device.onProperties Called with friendly properties on
     *        every unsolicited status message for this device
     * @returns {Promise<void>}
     */
    async attachDevice({ mac, key, onProperties }) {
        const { parentMac, childMac } = resolveMacs(mac);

        this._devices.set(mac, {
            cipher: new CloudCipher(key),
            parentMac,
            childMac,
            onProperties: onProperties || (() => {}),
        });

        await this._subscribe(parentMac);
    }

    /**
     * Stop routing replies for a device. The connection stays open for others.
     *
     * @param {string} mac
     */
    detachDevice(mac) {
        this._devices.delete(mac);
    }

    get deviceCount() {
        return this._devices.size;
    }

    /**
     * Ask a device for the current value of the given vendor properties.
     *
     * @param {string} mac
     * @param {string[]} cols Vendor property codes
     * @returns {Promise<object>} Friendly properties
     */
    async getStatus(mac, cols) {
        const reply = await this._request(mac, { t: 'status', cols });

        return { cols: reply.cols, dat: reply.dat };
    }

    /**
     * Write vendor properties to a device.
     *
     * @param {string} mac
     * @param {Object<string, string|number>} vendorProperties
     * @returns {Promise<object>} Confirmed vendor properties
     */
    async setProperties(mac, vendorProperties) {
        const opt = Object.keys(vendorProperties);
        const reply = await this._request(mac, {
            t: 'cmd',
            opt,
            p: opt.map((code) => vendorProperties[code]),
        });

        return { opt: reply.opt, p: 'p' in reply ? reply.p : reply.val };
    }

    /**
     * Publish an encrypted request and wait for the matching reply.
     *
     * @param {string} mac
     * @param {object} pack Payload to encrypt
     * @returns {Promise<object>} Decrypted reply payload
     * @private
     */
    _request(mac, pack) {
        // Check the connection first: when the app is offline that is the
        // accurate and actionable reason, whether or not a device is attached.
        if (!this.connected) {
            return Promise.reject(new CloudError(ERROR.NETWORK, 'Not connected to the Gree cloud'));
        }

        const device = this._devices.get(mac);
        if (!device) {
            return Promise.reject(new CloudError(ERROR.CLOUD, `Device ${mac} is not attached`));
        }

        // The reply is correlated by `cid`, so it has to be unique per request.
        const cid = String(randomInt(1000000000, 9999999999));
        this._sequence += 1;

        const encrypted = device.cipher.encrypt(pack);
        const envelope = {
            cid,
            i: this._sequence,
            pack: encrypted.pack,
            t: 'pack',
            tcid: device.childMac,
            uid: this._uid,
        };

        if (encrypted.tag) {
            envelope.tag = encrypted.tag;
        }

        return new Promise((resolve, reject) => {
            const timeoutRef = setTimeout(() => {
                this._pending.delete(cid);
                reject(new CloudError(ERROR.NETWORK, `No reply from ${mac} within ${this._requestTimeout} ms`));
            }, this._requestTimeout);

            this._pending.set(cid, { resolve, reject, timeoutRef });

            this._client.publish(`request/${device.parentMac}`, JSON.stringify(envelope), { qos: 0 }, (error) => {
                if (!error) {
                    return;
                }

                clearTimeout(timeoutRef);
                this._pending.delete(cid);
                reject(new CloudError(ERROR.NETWORK, `Could not publish to ${device.parentMac}: ${error.message}`));
            });
        });
    }

    /**
     * @param {string} parentMac
     * @returns {Promise<void>}
     * @private
     */
    _subscribe(parentMac) {
        if (this._subscribed.has(parentMac)) {
            return Promise.resolve();
        }

        // `connect/<mac>` is deliberately not subscribed: it uses an encryption
        // scheme this client does not implement.
        const topics = [`response/${parentMac}/#`, `status/${parentMac}/#`];

        return new Promise((resolve, reject) => {
            this._client.subscribe(topics, { qos: 0 }, (error) => {
                if (error) {
                    reject(new CloudError(ERROR.NETWORK, `Could not subscribe to ${parentMac}: ${error.message}`));
                    return;
                }

                this._subscribed.add(parentMac);
                resolve();
            });
        });
    }

    /**
     * Decrypt an inbound message and either resolve a pending request or hand
     * the properties to the device it belongs to.
     *
     * @param {string} topic
     * @param {Buffer} payload
     * @private
     */
    _onMessage(topic, payload) {
        let envelope;
        try {
            envelope = JSON.parse(payload.toString('utf8'));
        } catch (error) {
            this._logger.error('[mqtt]', 'ignoring unparsable message on', topic);
            return;
        }

        if (typeof envelope.pack !== 'string') {
            return;
        }

        const device = this._deviceForEnvelope(topic, envelope);
        if (!device) {
            // Another client on this account, or a device we do not manage.
            return;
        }

        let decrypted;
        try {
            decrypted = device.cipher.decrypt(envelope.pack, envelope.tag);
        } catch (error) {
            this._logger.error('[mqtt]', 'could not decrypt a message on', topic);
            return;
        }

        const pending = envelope.cid !== undefined ? this._pending.get(String(envelope.cid)) : undefined;
        if (pending) {
            clearTimeout(pending.timeoutRef);
            this._pending.delete(String(envelope.cid));

            if (decrypted.r !== undefined && decrypted.r !== 200) {
                pending.reject(new CloudError(ERROR.CLOUD, `Device replied ${decrypted.r}`));
                return;
            }

            pending.resolve(decrypted);
            return;
        }

        // Unsolicited status push.
        const codes = decrypted.cols || decrypted.opt;
        const values = decrypted.dat || decrypted.p || decrypted.val;
        if (Array.isArray(codes) && Array.isArray(values)) {
            device.onProperties(codes, values);
        }
    }

    /**
     * Find the attached device an inbound message belongs to. `tcid` names it
     * directly; otherwise fall back to the parent MAC in the topic, which is
     * unambiguous unless a gateway hosts several attached children.
     *
     * @param {string} topic
     * @param {object} envelope
     * @returns {object|undefined}
     * @private
     */
    _deviceForEnvelope(topic, envelope) {
        if (envelope.tcid) {
            const byChild = [...this._devices.values()]
                .find((device) => device.childMac === envelope.tcid);

            if (byChild) {
                return byChild;
            }
        }

        const parentMac = topic.split('/')[1];

        return [...this._devices.values()].find((device) => device.parentMac === parentMac);
    }

    /**
     * Translate an mqtt.js error into a cloud error reason.
     *
     * @param {Error} error
     * @returns {CloudError}
     * @private
     */
    _classifyError(error) {
        // The broker answers a stale token with CONNACK code 4/5.
        const code = error.code !== undefined ? Number(error.code) : undefined;
        if (code === 4 || code === 5 || /not authorized|bad user name/i.test(error.message)) {
            return new CloudError(ERROR.SESSION_EXPIRED, `Broker rejected the credentials: ${error.message}`);
        }

        return new CloudError(ERROR.NETWORK, `Broker connection failed: ${error.message}`);
    }

    /**
     * Reject every request still waiting for a reply.
     *
     * @param {Error} error
     * @private
     */
    _failPending(error) {
        this._pending.forEach(({ reject, timeoutRef }) => {
            clearTimeout(timeoutRef);
            reject(error);
        });
        this._pending.clear();
    }

    /**
     * Drop the client without waiting for a clean disconnect.
     *
     * @private
     */
    _teardown() {
        if (!this._client) {
            return;
        }

        const client = this._client;
        this._client = null;
        this._subscribed.clear();

        client.removeAllListeners();

        // Keep a sink attached: a client that errors after we let go of it would
        // otherwise throw the error as an unhandled exception.
        client.on('error', (error) => {
            this._logger.log('[mqtt]', 'error from a discarded client:', error.message);
        });

        try {
            client.end(true);
        } catch (error) {
            this._logger.error('[mqtt]', 'could not end the client:', error.message);
        }
    }

    /**
     * Close the connection and release every timer and pending request.
     */
    disconnect() {
        this._failPending(new CloudError(ERROR.NETWORK, 'Disconnecting from the Gree cloud'));
        this._devices.clear();
        this._teardown();
    }

}

module.exports = {
    CloudMqttClient,
    resolveMacs,
    deduplicateDevices,
    DEFAULT_PORT,
};
