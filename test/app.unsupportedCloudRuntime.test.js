'use strict';

describe('GreeHVAC app unsupported cloud runtime report', () => {
    let app;
    let captureMessage;

    beforeEach(async () => {
        jest.resetModules();

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

        // eslint-disable-next-line global-require
        const GreeHVAC = require('../app');

        app = new GreeHVAC();
        app.log = jest.fn();
        app.error = jest.fn();
        app.homey = {
            flow: {
                getConditionCard: jest.fn(() => ({ registerRunListener: jest.fn() })),
                getActionCard: jest.fn(() => ({ registerRunListener: jest.fn() })),
            },
            notifications: { createNotification: jest.fn().mockResolvedValue() },
            __: jest.fn((key) => key),
        };

        await app.onInit();
    });

    test('reports the refusal to Sentry with the Node.js version', () => {
        app._reportUnsupportedCloudRuntime();

        expect(captureMessage).toHaveBeenCalledTimes(1);
        expect(captureMessage).toHaveBeenCalledWith(
            `Gree Cloud refused: no global fetch (Node.js ${process.version})`,
        );
    });

    test('reports only once per session', () => {
        app._reportUnsupportedCloudRuntime();
        app._reportUnsupportedCloudRuntime();
        app._reportUnsupportedCloudRuntime();

        expect(captureMessage).toHaveBeenCalledTimes(1);
    });

    test('a failing Sentry report is logged, not thrown', async () => {
        const failure = new Error('boom');
        captureMessage.mockRejectedValueOnce(failure);

        expect(() => app._reportUnsupportedCloudRuntime()).not.toThrow();
        await Promise.resolve();

        expect(app.error).toHaveBeenCalledWith(failure);
    });
});
