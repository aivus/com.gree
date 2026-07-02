'use strict';

const EventEmitter = require('events');

describe('Finder stop', () => {
    let finder;
    let sockets;
    let createSocket;

    function makeFakeSocket() {
        const socket = new EventEmitter();
        socket.bind = jest.fn(() => {
            process.nextTick(() => socket.emit('listening'));
        });
        socket.setBroadcast = jest.fn();
        socket.send = jest.fn();
        socket.close = jest.fn();
        return socket;
    }

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();

        sockets = [];
        createSocket = jest.fn(() => {
            const socket = makeFakeSocket();
            sockets.push(socket);
            return socket;
        });

        jest.doMock('dgram', () => ({
            createSocket,
        }));

        jest.doMock('gree-hvac-client/src/encryption-service', () => ({
            EcbCipher: jest.fn().mockImplementation(() => ({ decrypt: jest.fn() })),
            GcmCipher: jest.fn().mockImplementation(() => ({ decrypt: jest.fn() })),
        }));

        jest.doMock('gree-hvac-client/src/logger', () => ({
            createLogger: jest.fn(() => ({
                info: jest.fn(),
                error: jest.fn(),
                child: jest.fn().mockReturnThis(),
            })),
        }));

        finder = require('../drivers/gree_cooper_hunter_hvac/network/finder');
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('closes the socket and stops broadcasting', () => {
        // Let the socket emit 'listening' so the broadcast interval is set
        jest.runOnlyPendingTimers();
        sockets[0].send.mockClear();

        finder.stop();

        expect(sockets[0].close).toHaveBeenCalled();

        jest.advanceTimersByTime(60 * 1000);
        expect(sockets[0].send).not.toHaveBeenCalled();
    });

    test('cancels a pending restart', () => {
        sockets[0].emit('error', new Error('boom'));

        finder.stop();

        jest.advanceTimersByTime(60 * 1000);

        // No new socket was created by the pending restart
        expect(sockets).toHaveLength(1);
    });

    test('rejects pending probes', async () => {
        const probe = finder.probe('192.168.1.50');

        finder.stop();

        await expect(probe).rejects.toThrow('Finder is stopping');
        expect(finder._pendingProbes['192.168.1.50']).toBeUndefined();
    });

    test('survives close() throwing when the socket is already closed', () => {
        sockets[0].close.mockImplementation(() => {
            throw new Error('Not running');
        });

        expect(() => finder.stop()).not.toThrow();
    });
});
