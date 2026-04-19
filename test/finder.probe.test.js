'use strict';

const EventEmitter = require('events');

describe('Finder.probe()', () => {
    let finder;
    let fakeSocket;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();

        fakeSocket = new EventEmitter();
        fakeSocket.bind = jest.fn((port, cb) => {
            process.nextTick(() => {
                if (cb) cb();
                fakeSocket.emit('listening');
            });
        });
        fakeSocket.setBroadcast = jest.fn();
        fakeSocket.send = jest.fn();
        fakeSocket.close = jest.fn();

        jest.doMock('dgram', () => ({
            createSocket: jest.fn(() => fakeSocket),
        }));

        jest.doMock('gree-hvac-client/src/encryption-service', () => ({
            EncryptionService: jest.fn().mockImplementation(() => ({
                decrypt: jest.fn((msg) => ({
                    mac: 'aabbccddeeff',
                    cid: 'aabbccddeeff',
                    name: 'TestDevice',
                    t: 'dev',
                })),
            })),
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

    test('sends a UDP scan message to the given IP on port 7000', async () => {
        const probePromise = finder.probe('192.168.1.50');

        // Simulate device response
        fakeSocket.emit('message', Buffer.from('{"t":"dev","pack":"x"}'), { address: '192.168.1.50' });

        await probePromise;

        const SCAN_MESSAGE = Buffer.from('{"t": "scan"}');
        expect(fakeSocket.send).toHaveBeenCalledWith(
            SCAN_MESSAGE,
            0,
            SCAN_MESSAGE.length,
            7000,
            '192.168.1.50',
        );
    });

    test('resolves with device info when the target IP responds', async () => {
        const probePromise = finder.probe('192.168.1.50');

        fakeSocket.emit('message', Buffer.from('{"t":"dev","pack":"x"}'), { address: '192.168.1.50' });

        const result = await probePromise;

        expect(result.message.mac).toBe('aabbccddeeff');
        expect(result.remoteInfo.address).toBe('192.168.1.50');
    });

    test('does not resolve when a different IP responds', async () => {
        const resolved = jest.fn();
        finder.probe('192.168.1.50').then(resolved);

        // Response from a different IP — should not trigger resolve
        fakeSocket.emit('message', Buffer.from('{"t":"dev","pack":"x"}'), { address: '192.168.1.99' });

        await Promise.resolve(); // flush microtasks
        expect(resolved).not.toHaveBeenCalled();
    });

    test('rejects after 5 seconds with no response', async () => {
        const probePromise = finder.probe('192.168.1.50');

        jest.advanceTimersByTime(5001);

        await expect(probePromise).rejects.toThrow('No response from device at 192.168.1.50');
    });

    test('adds the discovered device to hvacs registry', async () => {
        const probePromise = finder.probe('192.168.1.50');

        fakeSocket.emit('message', Buffer.from('{"t":"dev","pack":"x"}'), { address: '192.168.1.50' });

        await probePromise;

        expect(finder.hvacs).toHaveLength(1);
        expect(finder.hvacs[0].message.mac).toBe('aabbccddeeff');
    });
});
