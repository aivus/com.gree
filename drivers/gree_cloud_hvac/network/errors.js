'use strict';

/**
 * Reasons a Gree cloud request can fail. The driver maps these onto localised
 * messages, so a reason must never carry credentials or other secrets.
 *
 * @readonly
 * @property {string} INVALID_CREDENTIALS - Wrong e-mail address or password
 * @property {string} SESSION_EXPIRED - The cloud rejected our token
 * @property {string} RATE_LIMITED - The cloud is temporarily refusing requests
 * @property {string} NETWORK - The cloud could not be reached
 * @property {string} CLOUD - The cloud answered something unusable
 */
const ERROR = {
    INVALID_CREDENTIALS: 'invalid_credentials',
    SESSION_EXPIRED: 'session_expired',
    RATE_LIMITED: 'rate_limited',
    NETWORK: 'network',
    CLOUD: 'cloud',
};

class CloudError extends Error {

    /**
     * @param {string} reason One of ERROR
     * @param {string} message Technical message, safe to log
     */
    constructor(reason, message) {
        super(message);
        this.name = 'CloudError';
        this.reason = reason;
    }

}

module.exports = {
    CloudError,
    ERROR,
};
