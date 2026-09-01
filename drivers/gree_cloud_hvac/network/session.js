'use strict';

const { CloudConnection } = require('./connection');

/**
 * Registry of Gree cloud accounts, shared by the driver and every device.
 *
 * A Gree account only allows one active session, so all devices belonging to
 * the same account must share a single connection. This module is that shared
 * point. Unlike the local driver's finder it does not start anything on
 * require: nothing happens until a device or a pairing session asks for a
 * connection.
 *
 * `stop()` releases every connection and is called from the driver's onUninit.
 */

/**
 * Identify an account. Regions are separate namespaces, and the same address
 * can legitimately exist in two of them.
 *
 * @param {string} region
 * @param {string} username
 * @returns {string}
 */
function accountKey(region, username) {
    return `${region}:${String(username).trim().toLowerCase()}`;
}

class CloudSession {

    constructor() {
        /**
         * Open connections, keyed by accountKey().
         *
         * @type {Map<string, CloudConnection>}
         * @private
         */
        this._connections = new Map();

        this._createConnection = (options) => new CloudConnection(options);
    }

    /**
     * Replace the connection factory. For tests only.
     *
     * @param {Function} factory
     */
    setConnectionFactory(factory) {
        this._createConnection = factory;
    }

    get size() {
        return this._connections.size;
    }

    /**
     * Get the connection for an account, creating it if needed.
     *
     * Credentials are passed on every call because they may have changed (the
     * user repaired the device); a stored token is only used as a starting
     * point and is replaced as soon as the cloud hands out a new one.
     *
     * @param {object} options
     * @param {string} options.region
     * @param {string} options.username
     * @param {string} options.password
     * @param {object} [options.account] Previously stored {uid, token}
     * @param {object} [options.logger]
     * @param {object} [options.clientOptions]
     * @param {Function} [options.onAccountChange]
     * @returns {CloudConnection}
     */
    getConnection({
        region, username, password, account, logger, clientOptions, onAccountChange,
    }) {
        const key = accountKey(region, username);
        const existing = this._connections.get(key);

        if (existing) {
            return existing;
        }

        const connection = this._createConnection({
            region,
            username,
            password,
            account,
            logger,
            clientOptions,
            onAccountChange,
        });

        this._connections.set(key, connection);

        return connection;
    }

    /**
     * Sign in with fresh credentials and list the account's devices. Used while
     * pairing and repairing, where the existing connection (if any) must not be
     * reused, because the point is to validate what the user just typed.
     *
     * @param {object} options
     * @param {string} options.region
     * @param {string} options.username
     * @param {string} options.password
     * @param {object} [options.logger]
     * @returns {Promise<{account: object, devices: Array<object>}>}
     */
    async signIn({
        region, username, password, logger,
    }) {
        const connection = this._createConnection({
            region, username, password, logger,
        });

        const account = await connection.authenticate(true);
        const devices = await connection.listDevices();

        // This throwaway connection never opened a broker socket, but close it
        // anyway so a future implementation change cannot leak one.
        connection.stop();

        return { account, devices };
    }

    /**
     * Drop the connection for an account, closing it first.
     *
     * @param {string} region
     * @param {string} username
     */
    release(region, username) {
        const key = accountKey(region, username);
        const connection = this._connections.get(key);

        if (!connection) {
            return;
        }

        this._connections.delete(key);
        connection.stop();
    }

    /**
     * Close every connection and forget every account. Called when the app is
     * shutting down, so no broker socket or timer outlives it.
     */
    stop() {
        this._connections.forEach((connection) => {
            try {
                connection.stop();
            } catch (error) {
                // Nothing useful to do here; the app is going away regardless.
            }
        });

        this._connections.clear();
    }

}

module.exports = new CloudSession();
module.exports.CloudSession = CloudSession;
module.exports.accountKey = accountKey;
