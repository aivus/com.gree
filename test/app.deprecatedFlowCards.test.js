'use strict';

describe('GreeHVAC app deprecated flow card notifications', () => {
    let GreeHVAC;
    let app;
    let runListeners;
    let createNotification;
    let captureMessage;

    function makeCard(id) {
        return {
            registerRunListener: jest.fn((listener) => {
                runListeners[id] = listener;
            }),
        };
    }

    beforeEach(async () => {
        jest.resetModules();

        runListeners = {};
        createNotification = jest.fn().mockResolvedValue();
        captureMessage = jest.fn().mockResolvedValue();

        jest.doMock('homey', () => ({
            App: class App {
                log() {}
                error() {}
            },
            manifest: { version: '0.0.0-test' },
        }));

        jest.doMock('homey-log', () => ({
            Log: jest.fn().mockImplementation(() => ({ captureMessage })),
        }));

        GreeHVAC = require('../app');

        app = new GreeHVAC();
        app.log = jest.fn();
        app.error = jest.fn();
        app.homey = {
            flow: {
                getConditionCard: jest.fn((id) => makeCard(id)),
                getActionCard: jest.fn((id) => makeCard(id)),
                getDeviceTriggerCard: jest.fn((id) => makeCard(id)),
            },
            notifications: { createNotification },
            __: jest.fn((key, tags) => (tags ? `${key}:${tags.card}` : key)),
        };

        await app.onInit();
    });

    test('registers a run listener for the deprecated hvac_mode_changed trigger', () => {
        expect(app.homey.flow.getDeviceTriggerCard).toHaveBeenCalledWith('hvac_mode_changed');
        expect(typeof runListeners.hvac_mode_changed).toBe('function');
    });

    test('the trigger run listener returns true and notifies once', async () => {
        expect(runListeners.hvac_mode_changed()).toBe(true);
        // The notification is fire-and-forget, allow the microtask to resolve.
        await Promise.resolve();

        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(createNotification).toHaveBeenCalledWith({
            excerpt: 'deprecated.notification:deprecated.cards.hvac_mode_changed',
        });
    });

    test('reports deprecated card usage to Sentry', async () => {
        runListeners.hvac_mode_changed();
        await Promise.resolve();

        expect(captureMessage).toHaveBeenCalledTimes(1);
        expect(captureMessage).toHaveBeenCalledWith('Deprecated flow card used: hvac_mode_changed');
    });

    test('does not notify again for the same card within a session', async () => {
        runListeners.hvac_mode_changed();
        runListeners.hvac_mode_changed();
        runListeners.hvac_mode_changed();
        await Promise.resolve();

        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(captureMessage).toHaveBeenCalledTimes(1);
    });

    test('the deprecated condition notifies once and preserves its result', async () => {
        const device = { log: jest.fn(), getCapabilityValue: jest.fn(() => 'cool') };

        const result = runListeners.hvac_mode_is({ device, mode: 'cool' }, {});
        await Promise.resolve();

        expect(result).toBe(true);
        expect(device.getCapabilityValue).toHaveBeenCalledWith('thermostat_mode');
        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(createNotification).toHaveBeenCalledWith({
            excerpt: 'deprecated.notification:deprecated.cards.hvac_mode_is',
        });
    });

    test('the deprecated action notifies once and preserves its result', async () => {
        const device = {
            setCapabilityValue: jest.fn().mockResolvedValue(),
            triggerCapabilityListener: jest.fn().mockResolvedValue(),
        };

        await runListeners.set_hvac_mode({ device, mode: 'heat' }, {});

        expect(device.setCapabilityValue).toHaveBeenCalledWith('thermostat_mode', 'heat');
        expect(device.triggerCapabilityListener).toHaveBeenCalledWith('thermostat_mode', 'heat', {});
        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(createNotification).toHaveBeenCalledWith({
            excerpt: 'deprecated.notification:deprecated.cards.set_hvac_mode',
        });
    });

    test('a failing notification does not throw out of the run listener', async () => {
        createNotification.mockRejectedValueOnce(new Error('boom'));

        expect(() => runListeners.hvac_mode_changed()).not.toThrow();
        await Promise.resolve();
        await Promise.resolve();

        expect(app.error).toHaveBeenCalled();
    });
});
