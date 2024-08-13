'use strict';

const dgram = require('dgram');
const { EncryptionService } = require('gree-hvac-client/src/encryption-service');

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
        console.debug('[finder]', 'start listening');
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
        console.debug('[finder]', 'send broadcast message');
        this.server.setBroadcast(true);
        this.server.send(SCAN_MESSAGE, 0, SCAN_MESSAGE.length, 7000, '255.255.255.255');
    }

    _onMessage(message, remoteInfo) {
        console.debug('[finder]', 'message received');
        try {
            const parsedMessage = JSON.parse(message);

            // Skip scan messages
            if (parsedMessage.t === 'scan') {
                console.debug('[finder]', 'scan message. Skipping...');
                return;
            }

            const decryptedMessage = this._encryptionService.decrypt(parsedMessage);

            this._hvacs[decryptedMessage.mac] = { message: decryptedMessage, remoteInfo };

            console.debug('[finder]', 'HVAC found. Remote info: ', remoteInfo, 'Message: ', decryptedMessage);

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
        console.error('error occurs, restart server');
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
