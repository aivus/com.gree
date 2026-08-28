'use strict';

const {
    PROPERTY, VALUE, POLLED_VENDOR_CODES, toVendor, fromVendor, fromColumns,
} = require('../drivers/gree_cloud_hvac/network/properties');

describe('cloud properties vocabulary', () => {
    // The cloud device reuses the local driver's capability bridge verbatim, so
    // the property and value names must stay identical to gree-hvac-client's.
    it('re-exports the same property names as the local client', () => {
        expect(PROPERTY).toEqual(require('gree-hvac-client').PROPERTY);
    });

    it('re-exports the same property values as the local client', () => {
        expect(VALUE).toEqual(require('gree-hvac-client').VALUE);
    });

    it('asks the device for the vendor codes behind every mapped capability', () => {
        expect(POLLED_VENDOR_CODES).toEqual([
            'Pow', 'Mod', 'TemUn', 'SetTem', 'TemSen', 'WdSpd', 'Air', 'Blo',
            'Health', 'SwhSlp', 'Lig', 'SwingLfRig', 'SwUpDn', 'Quiet', 'Tur',
            'SvSt', 'StHt',
        ]);
    });

    it('never asks for an undefined vendor code', () => {
        expect(POLLED_VENDOR_CODES.filter((code) => !code)).toEqual([]);
    });
});

describe('toVendor()', () => {
    it('translates friendly names and values into vendor codes', () => {
        expect(toVendor({ mode: 'heat', temperature: 22 })).toEqual({ Mod: 4, SetTem: 22 });
    });

    it('writes the SwhSlp/SlpMod pair together for sleep mode', () => {
        // Many units ignore SwhSlp unless SlpMod moves with it.
        expect(toVendor({ sleep: 'on' })).toEqual({ SwhSlp: 1, SlpMod: 1 });
        expect(toVendor({ sleep: 'off' })).toEqual({ SwhSlp: 0, SlpMod: 0 });
    });

    it('translates every fan speed and swing position', () => {
        expect(toVendor({ fanSpeed: 'mediumHigh' })).toEqual({ WdSpd: 4 });
        expect(toVendor({ swingVert: 'fixedBottom' })).toEqual({ SwUpDn: 6 });
        expect(toVendor({ swingHor: 'fixedRight' })).toEqual({ SwingLfRig: 6 });
    });
});

describe('fromVendor()', () => {
    it('translates vendor codes into friendly names and values', () => {
        expect(fromVendor({ Pow: 1, Mod: 1, WdSpd: 0 }))
            .toEqual({ power: 'on', mode: 'cool', fanSpeed: 'auto' });
    });

    it('skips vendor codes it does not model', () => {
        // The cloud reports extras such as ElcAll that are not mapped yet.
        expect(fromVendor({ Pow: 1, ElcAll: 1234, SlpMod: 1 })).toEqual({ power: 'on' });
    });

    it('decodes the internal temperature sensor offset', () => {
        expect(fromVendor({ TemSen: 65 })).toEqual({ currentTemperature: 25 });
    });

    it('keeps an unsupported temperature sensor reading as zero', () => {
        expect(fromVendor({ TemSen: 0 })).toEqual({ currentTemperature: 0 });
    });

    it('passes through a sensor reading from firmware that applies no offset', () => {
        // Subtracting 40 here would report an impossible -9 degrees.
        expect(fromVendor({ TemSen: 31 })).toEqual({ currentTemperature: 31 });
    });
});

describe('fromColumns()', () => {
    it('zips a status reply into friendly properties', () => {
        expect(fromColumns(['Pow', 'Mod', 'SetTem'], [1, 4, 24]))
            .toEqual({ power: 'on', mode: 'heat', temperature: 24 });
    });

    it('ignores columns the device did not send a value for', () => {
        expect(fromColumns(['Pow', 'Mod', 'SetTem'], [1])).toEqual({ power: 'on' });
    });

    it('ignores values without a matching column', () => {
        expect(fromColumns(['Pow'], [1, 4, 24])).toEqual({ power: 'on' });
    });

    it('returns nothing for a malformed reply', () => {
        expect(fromColumns(undefined, [1])).toEqual({});
        expect(fromColumns(['Pow'], undefined)).toEqual({});
        expect(fromColumns('Pow', 1)).toEqual({});
    });
});
