'use strict';

/**
 * Compare boolean properties
 *
 * @param {string} propertyValue
 * @param {string} capabilityValue
 * @param {string} trueValue
 * @returns {boolean}
 */
function compareBoolProperties(propertyValue, capabilityValue, trueValue) {
    const changedFromTrueToFalse = capabilityValue && propertyValue !== trueValue;
    const changedFromFalseToTrue = !capabilityValue && propertyValue === trueValue;

    return changedFromFalseToTrue || changedFromTrueToFalse;
}

/**
 * Check that the given string is a valid IPv4 address
 *
 * @param {string} ip
 * @returns {boolean}
 */
function isValidIpv4(ip) {
    if (!ip) {
        return false;
    }

    const octets = ip.trim().split('.');
    return octets.length === 4 && octets.every((octet) => {
        if (!/^\d+$/.test(octet)) {
            return false;
        }

        // Reject leading zeros ("01") which dgram may treat as octal
        if (String(Number(octet)) !== octet) {
            return false;
        }

        return Number(octet) <= 255;
    });
}

module.exports = {
    compareBoolProperties,
    isValidIpv4,
};
