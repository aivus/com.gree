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

module.exports = {
    compareBoolProperties,
};
