'use strict';

const { EventEmitter } = require('events');

describe('GreeHVACDevice._tryToDisconnect()', () => {
    let GreeHVACDevice;
    let device;

    beforeEach(() => {
        jest.resetModules();

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));

        jest.doMock('gree-hvac-client', () => ({
            PROPERTY: {},
            VALUE: {},
        }));

        jest.doMock('homey', () => ({
            Device: class Device {
                log() {}
                error() {}
            },
        }));

        GreeHVACDevice = require('../drivers/gree_cooper_hunter_hvac/device');

        device = new GreeHVACDevice();
        device.log = jest.fn();
        device.error = jest.fn();
    });

    test('handles disconnect() rejection instead of leaving it unhandled', async () => {
        const rejection = new Error('Client is not connected to the HVAC');
        device._client = {
            on: jest.fn(),
            removeAllListeners: jest.fn(),
            disconnect: jest.fn().mockRejectedValue(rejection),
        };

        device._tryToDisconnect();

        expect(device._client).toBeNull();

        // Flush microtasks so the rejection is delivered
        await new Promise((resolve) => process.nextTick(resolve));

        expect(device.error).toHaveBeenCalledWith(rejection);
    });

    test('removes listeners before disconnecting and clears the client', () => {
        const client = {
            on: jest.fn(),
            removeAllListeners: jest.fn(),
            disconnect: jest.fn().mockResolvedValue(),
        };
        device._client = client;

        device._tryToDisconnect();

        expect(client.removeAllListeners).toHaveBeenCalled();
        expect(client.disconnect).toHaveBeenCalled();
        expect(device._client).toBeNull();
    });

    test('does nothing when there is no client', () => {
        device._client = null;

        expect(() => device._tryToDisconnect()).not.toThrow();
    });

    // Regression test for Sentry GREE-HOMEY-8: the HVAC client can keep an
    // orphaned reconnect timer running after disconnect() and emits 'error' on
    // every tick. Without a listener, EventEmitter re-throws that error from a
    // .catch() callback inside the library, which surfaces as an unhandled
    // rejection every connectTimeout, forever.
    describe('a dropped client that keeps emitting errors', () => {
        let client;

        beforeEach(() => {
            client = new EventEmitter();
            client.disconnect = jest.fn().mockResolvedValue();
            jest.spyOn(client, 'removeAllListeners');

            // Listeners the device registers while the client is in use
            client.on('error', () => {});
            client.on('update', () => {});
        });

        test('keeps an error sink attached so late errors cannot become unhandled', () => {
            device._client = client;

            device._tryToDisconnect();

            expect(client.listenerCount('update')).toBe(0);
            expect(client.listenerCount('error')).toBe(1);

            const error = new Error('Client is not connected to the HVAC');
            expect(() => client.emit('error', error)).not.toThrow();
            expect(device.log).toHaveBeenCalledWith(
                '[disconnect]',
                'Error from an already disconnected client:',
                error,
            );
        });

        test('logs non-Error emissions as-is instead of undefined', () => {
            device._client = client;

            device._tryToDisconnect();

            expect(() => client.emit('error', 'connection lost')).not.toThrow();
            expect(device.log).toHaveBeenCalledWith(
                '[disconnect]',
                'Error from an already disconnected client:',
                'connection lost',
            );
        });

        test('attaches the sink after removing the device listeners', () => {
            device._client = client;

            device._tryToDisconnect();

            const removeOrder = client.removeAllListeners.mock.invocationCallOrder[0];
            const disconnectOrder = client.disconnect.mock.invocationCallOrder[0];

            expect(removeOrder).toBeLessThan(disconnectOrder);
            expect(client.listenerCount('error')).toBe(1);
        });
    });
});
