'use strict';

const dgram = require('dgram');
const { EcbCipher, GcmCipher } = require('gree-hvac-client/src/encryption-service');
const { createLogger } = require('gree-hvac-client/src/logger');
const { randomUUID } = require('crypto');

const SCAN_MESSAGE = Buffer.from('{"t": "scan"}');
const THIRTY_SECONDS = 30 * 1000;

// Delay before recreating the socket after an error to avoid a tight
// error -> restart -> error loop (e.g. when port 7000 is already in use)
const RESTART_DELAY = 10 * 1000;

class Finder {

    constructor() {
        this._encryptionServiceLogger = createLogger('info').child({
            service: 'finder',
            sid: randomUUID(),
        });
        // Devices answer the scan with their generic key. Older devices use
        // AES-ECB, newer ones (firmware V2.x) use AES-GCM, so try both.
        this._ciphers = [new EcbCipher(), new GcmCipher()];
        this._hvacs = {};
        this.start();
    }

    start() {
        this._listen();
        this._encryptionServiceLogger.info('start listening');
        this.server.on('listening', () => {
            this._broadcast();
            this.broadcastInterval = setInterval(this._broadcast.bind(this), THIRTY_SECONDS);
        });
    }

    _listen() {
        this.server = dgram.createSocket({
            type: 'udp4',
            reuseAddr: true,
        });

        this.server.on('error', this._restart.bind(this));
        this.server.on('message', this._onMessage.bind(this));
        this.server.bind(7000);
    }

    _broadcast() {
        this._encryptionServiceLogger.info('send broadcast message');
        try {
            this.server.setBroadcast(true);
            this.server.send(SCAN_MESSAGE, 0, SCAN_MESSAGE.length, 7000, '255.255.255.255');
        } catch (error) {
            // setBroadcast()/send() throw when the socket is not bound or already
            // closed. An uncaught exception here would crash the whole app.
            this._encryptionServiceLogger.error('failed to send broadcast message', { error });
        }
    }

    _onMessage(message, remoteInfo) {
        this._encryptionServiceLogger.info('message received', { message });
        try {
            const parsedMessage = JSON.parse(message);

            // Skip scan messages
            if (parsedMessage.t === 'scan') {
                this._encryptionServiceLogger.info('scan message. Skipping...');
                return;
            }

            const decryptedMessage = this._decrypt(parsedMessage);

            this._hvacs[decryptedMessage.mac] = { message: decryptedMessage, remoteInfo };

            // Resolve any pending probe for this IP
            if (this._pendingProbes && this._pendingProbes[remoteInfo.address]) {
                const probe = this._pendingProbes[remoteInfo.address];
                clearTimeout(probe.timeoutRef);
                delete this._pendingProbes[remoteInfo.address];
                probe.resolve({ message: decryptedMessage, remoteInfo });
            }

            this._encryptionServiceLogger.info('HVAC found', {
                remoteInfo,
                decryptedMessage,
            });

            // { t: 'dev',
            //     cid: 'f4911e46fbd5',
            //     bc: 'gree',
            //     brand: 'gree',
            //     catalog: 'gree',
            //     mac: 'f4911e46fbd5',
            //     mid: '10001',
            //     model: 'gree',
            //     name: '1e46fbd5',
            //     series: 'gree',
            //     vender: '1',
            //     ver: 'V1.1.13',
            //     lock: 0 }
        } catch (e) {
            this._encryptionServiceLogger.error('Error occurred', {
                exception: e,
                message,
            });
        }
    }

    /**
     * Decrypt a device message, trying each supported cipher (ECB / GCM).
     *
     * @param {object} message Parsed UDP message with a `pack` field
     * @returns {object} Decrypted payload
     * @private
     */
    _decrypt(message) {
        let lastError;
        for (const cipher of this._ciphers) {
            try {
                return cipher.decrypt(message).payload;
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    }

    _restart(reason) {
        this._encryptionServiceLogger.error('restart server', { reason });

        if (this._restartTimeoutRef) {
            return;
        }

        clearInterval(this.broadcastInterval);
        this.server.removeAllListeners();
        try {
            this.server.close();
        } catch (error) {
            // close() throws when the socket is already closed / was never bound
            this._encryptionServiceLogger.error('failed to close server', { error });
        }

        this._restartTimeoutRef = setTimeout(() => {
            this._restartTimeoutRef = null;
            this.start();
        }, RESTART_DELAY);
    }

    /**
     * Send a unicast scan to a specific IP and resolve with the device info when it responds.
     *
     * @param {string} ip
     * @returns {Promise<{message: object, remoteInfo: object}>}
     */
    probe(ip) {
        if (!this._pendingProbes) {
            this._pendingProbes = {};
        }

        if (this._pendingProbes[ip]) {
            return this._pendingProbes[ip].promise;
        }

        let timeoutRef;
        let resolveProbe;
        let rejectProbe;

        const promise = new Promise((resolve, reject) => {
            resolveProbe = resolve;
            rejectProbe = reject;
            timeoutRef = setTimeout(() => {
                delete this._pendingProbes[ip];
                reject(new Error(`No response from device at ${ip}`));
            }, 5000);
        });

        this._pendingProbes[ip] = {
            promise,
            resolve: resolveProbe,
            reject: rejectProbe,
            timeoutRef,
        };

        try {
            this.server.send(SCAN_MESSAGE, 0, SCAN_MESSAGE.length, 7000, ip);
        } catch (error) {
            // send() throws when the socket is closed (e.g. during a restart).
            // Without this, the throw would leave a pending probe behind whose
            // timeout later rejects a promise nobody holds anymore.
            clearTimeout(timeoutRef);
            delete this._pendingProbes[ip];
            rejectProbe(error);
        }

        return promise;
    }

    get hvacs() {
        return Object.values(this._hvacs);
    }

}

module.exports = new Finder();
