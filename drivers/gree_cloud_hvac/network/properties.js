'use strict';

const { PROPERTY, VALUE } = require('gree-hvac-client');
const { PropertyTransformer } = require('gree-hvac-client/src/property-transformer');

/**
 * Property translation for the cloud transport.
 *
 * The Gree cloud speaks the same vendor property codes as the local UDP
 * protocol (`Pow`, `Mod`, `SetTem`, `WdSpd`, ...) and the same numeric values,
 * so `PropertyTransformer` from `gree-hvac-client` is reused unchanged. That
 * keeps a single mapping table for both drivers, including its handling of the
 * `TemSen` +40 offset and of the `SwhSlp`/`SlpMod` pair that has to be written
 * together.
 *
 * `PROPERTY` and `VALUE` are re-exported verbatim so the cloud device speaks
 * exactly the same vocabulary as the local one.
 */

const transformer = new PropertyTransformer();

// Properties the device is asked for on every poll. Deliberately the same set
// the local driver works with - the cloud also reports `ElcAll`,
// `CompressorFqy` and `OutEnvTem`, which are not mapped to capabilities yet.
const POLLED_PROPERTIES = [
    PROPERTY.power,
    PROPERTY.mode,
    PROPERTY.temperatureUnit,
    PROPERTY.temperature,
    PROPERTY.currentTemperature,
    PROPERTY.fanSpeed,
    PROPERTY.air,
    PROPERTY.blow,
    PROPERTY.health,
    PROPERTY.sleep,
    PROPERTY.lights,
    PROPERTY.swingHor,
    PROPERTY.swingVert,
    PROPERTY.quiet,
    PROPERTY.turbo,
    PROPERTY.powerSave,
    PROPERTY.safetyHeating,
];

// Vendor codes for the properties above, which is what a `status` request asks
// for. Built from the same table used for translation so the two cannot drift.
const POLLED_VENDOR_CODES = transformer.arrayToVendor(POLLED_PROPERTIES);

/**
 * Translate friendly property names and values into vendor codes and values.
 *
 * @param {Object<string, string|number>} properties
 * @returns {Object<string, string|number>}
 */
function toVendor(properties) {
    return transformer.toVendor(properties);
}

/**
 * Translate vendor codes and values into friendly names and values. Codes the
 * transformer does not model are skipped rather than throwing.
 *
 * @param {Object<string, string|number>} properties
 * @returns {Object<string, string|number>}
 */
function fromVendor(properties) {
    return transformer.fromVendor(properties);
}

/**
 * Rebuild a property object from the parallel arrays a device replies with.
 *
 * A `status` reply carries the requested codes in `cols` and their values in
 * `dat`; a command confirmation uses `opt` and `p` or `val`. Extra or missing
 * entries are ignored rather than throwing, since a device may answer with
 * fewer columns than were asked for.
 *
 * @param {string[]} codes Vendor property codes
 * @param {Array<string|number>} values Values, positionally matching `codes`
 * @returns {Object<string, string|number>} Friendly properties
 */
function fromColumns(codes, values) {
    if (!Array.isArray(codes) || !Array.isArray(values)) {
        return {};
    }

    const vendorProperties = {};
    codes.forEach((code, index) => {
        if (index < values.length) {
            vendorProperties[code] = values[index];
        }
    });

    return fromVendor(vendorProperties);
}

module.exports = {
    PROPERTY,
    VALUE,
    POLLED_PROPERTIES,
    POLLED_VENDOR_CODES,
    toVendor,
    fromVendor,
    fromColumns,
};
