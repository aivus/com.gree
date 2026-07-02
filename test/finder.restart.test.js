'use strict';

const EventEmitter = require('events');

describe('Finder error handling', () => {
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

    test('recreates the socket after an error, with a delay', () => {
        expect(sockets).toHaveLength(1);

        sockets[0].emit('error', new Error('EADDRINUSE'));

        // Not restarted immediately
        expect(sockets).toHaveLength(1);

        jest.advanceTimersByTime(10 * 1000);

        expect(sockets).toHaveLength(2);
        expect(sockets[0].close).toHaveBeenCalled();
        expect(sockets[1].bind).toHaveBeenCalledWith(7000);
    });

    test('does not schedule multiple restarts for repeated errors', () => {
        sockets[0].emit('error', new Error('first'));
        finder._restart(new Error('second'));
        finder._restart(new Error('third'));

        jest.advanceTimersByTime(30 * 1000);

        expect(sockets).toHaveLength(2);
    });

    test('survives close() throwing during restart', () => {
        sockets[0].close.mockImplementation(() => {
            throw new Error('Not running');
        });

        expect(() => sockets[0].emit('error', new Error('boom'))).not.toThrow();

        jest.advanceTimersByTime(10 * 1000);
        expect(sockets).toHaveLength(2);
    });

    test('broadcast failures do not throw', () => {
        sockets[0].setBroadcast.mockImplementation(() => {
            throw new Error('Not running');
        });

        expect(() => finder._broadcast()).not.toThrow();
    });

    test('probe rejects cleanly when send throws on a closed socket', async () => {
        sockets[0].send.mockImplementation(() => {
            throw new Error('Not running');
        });

        await expect(finder.probe('192.168.1.50')).rejects.toThrow('Not running');

        // The pending probe must be cleaned up so no orphaned timeout remains
        expect(finder._pendingProbes['192.168.1.50']).toBeUndefined();
    });
});
