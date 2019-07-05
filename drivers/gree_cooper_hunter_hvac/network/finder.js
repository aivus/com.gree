'use strict';

const dgram = require('dgram');
const {EncryptionService} = require('gree-hvac-client/lib/encryption-service');

const SCAN_MESSAGE = Buffer.from('{"t": "scan"}');
const THIRTY_SECONDS = 30 * 1000;

class Finder {
    constructor() {
        this._encryptionService = new EncryptionService();
        this._hvacs = {};
        this.start();
    }

    start() {
        this._listen();

        this.server.on('listening', () => {
            this._broadcast();
            this.broadcastInterval = setInterval(this._broadcast.bind(this), THIRTY_SECONDS);
        });
    }

    _listen() {
        this.server = dgram.createSocket({
            type: 'udp4',
            reuseAddr: true
        });

        this.server.on('error', this._restart.bind(this));
        this.server.on('message', this._onMessage.bind(this));
        this.server.bind(7000);
    }

    _broadcast() {
        this.server.setBroadcast(true);
        this.server.send(SCAN_MESSAGE, 0, SCAN_MESSAGE.length, 7000, '255.255.255.255');
    }

    _onMessage(message, remote_info) {

        if (message.toString() === SCAN_MESSAGE.toString()) {
            return;
        }

        try {
            const parsedMessage = JSON.parse(message);
            const decryptedMessage = this._encryptionService.decrypt(parsedMessage);

            this._hvacs[decryptedMessage.name] = {message: decryptedMessage, remoteInfo: remote_info};

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
            console.error(e);
        }

    }

    _restart(reason) {
        if (reason) console.error(reason);
        clearInterval(this.broadcastInterval);
        this.server.close();

        this.start();
    }

    get hvacs() {
        return Object.values(this._hvacs);
    }
}

module.exports = new Finder();