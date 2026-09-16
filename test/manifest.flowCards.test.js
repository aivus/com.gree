'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const LOCAL_DRIVER = 'gree_cooper_hunter_hvac';
const CLOUD_DRIVER = 'gree_cloud_hvac';

// Flow cards are part of the app's public contract: a card id that changes or
// disappears breaks every user Flow referencing it. Pin the full set.
const CARD_IDS = {
    triggers: [
        'fan_speed_changed',
        'fresh_air_mode_changed',
        'health_mode_changed',
        'horizontal_swing_changed',
        'hvac_mode_changed',
        'lights_changed',
        'power_save_mode_changed',
        'quiet_mode_changed',
        'safety_heating_changed',
        'sleep_mode_changed',
        'turbo_mode_changed',
        'vertical_swing_changed',
        'xfan_mode_changed',
    ],
    conditions: [
        'fan_speed_is',
        'fresh_air_mode_is',
        'health_mode_is',
        'horizontal_swing_is',
        'hvac_mode_is',
        'lights_is',
        'power_save_mode_is',
        'quiet_mode_is',
        'safety_heating_is',
        'sleep_mode_is',
        'turbo_mode_is',
        'vertical_swing_is',
        'xfan_mode_is',
    ],
    actions: [
        'set_fan_speed',
        'set_fresh_air_mode',
        'set_health_mode',
        'set_horizontal_swing',
        'set_hvac_mode',
        'set_lights',
        'set_power_save_mode',
        'set_quiet_mode',
        'set_safety_heating',
        'set_sleep_mode',
        'set_turbo_mode',
        'set_vertical_swing',
        'set_xfan_mode',
    ],
};

// Kept for backwards compatibility only. These are never offered to new
// drivers, so their device filter stays restricted to the original driver.
const DEPRECATED_CARD_IDS = ['hvac_mode_changed', 'hvac_mode_is', 'set_hvac_mode'];

const TYPES = ['triggers', 'conditions', 'actions'];

function readAppJson() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
}

/**
 * Every card in the generated manifest as [type, card] pairs.
 *
 * @returns {Array<[string, object]>}
 */
function allCards() {
    const appJson = readAppJson();

    return TYPES.flatMap((type) => appJson.flow[type].map((card) => [type, card]));
}

/**
 * Parse a Homey device-argument filter into the driver ids it accepts.
 *
 * @param {string} filter
 * @returns {string[]}
 */
function driverIdsFromFilter(filter) {
    const driverId = new URLSearchParams(filter).get('driver_id');

    return driverId === null ? [] : driverId.split('|');
}

describe('flow cards in the generated app.json', () => {
    it('contains exactly the expected card ids for every type', () => {
        const actual = {};
        const expected = {};

        TYPES.forEach((type) => {
            actual[type] = readAppJson().flow[type].map((card) => card.id).sort();
            expected[type] = [...CARD_IDS[type]].sort();
        });

        expect(actual).toEqual(expected);
    });

    it('gives every card a device argument first', () => {
        const offenders = allCards()
            .filter(([, card]) => {
                const first = Array.isArray(card.args) ? card.args[0] : undefined;

                return !first || first.type !== 'device' || first.name !== 'device';
            })
            .map(([type, card]) => `${type}/${card.id}`);

        expect(offenders).toEqual([]);
    });

    // homey-lib only exempts the first device argument from "titleFormatted"
    // validation when its filter carries a driver_id key. Filtering on anything
    // else (e.g. capabilities=) would force a [[device]] token into every
    // titleFormatted string, in all locales.
    it('filters every card on driver_id', () => {
        const offenders = allCards()
            .filter(([, card]) => driverIdsFromFilter(card.args[0].filter).length === 0)
            .map(([type, card]) => `${type}/${card.id}`);

        expect(offenders).toEqual([]);
    });

    it('offers every card to the local driver', () => {
        const offenders = allCards()
            .filter(([, card]) => !driverIdsFromFilter(card.args[0].filter).includes(LOCAL_DRIVER))
            .map(([type, card]) => `${type}/${card.id}`);

        expect(offenders).toEqual([]);
    });

    // Both drivers expose the same capabilities, so a Flow should be able to
    // pick either kind of device for the same card. Homey's filter syntax
    // expresses that by listing driver ids separated by a pipe.
    it('offers every current card to the cloud driver too', () => {
        const offenders = allCards()
            .filter(([, card]) => !DEPRECATED_CARD_IDS.includes(card.id))
            .filter(([, card]) => !driverIdsFromFilter(card.args[0].filter).includes(CLOUD_DRIVER))
            .map(([type, card]) => `${type}/${card.id}`);

        expect(offenders).toEqual([]);
    });

    it('restricts the deprecated cards to the local driver', () => {
        const restricted = {};

        allCards()
            .filter(([, card]) => DEPRECATED_CARD_IDS.includes(card.id))
            .forEach(([, card]) => {
                restricted[card.id] = {
                    deprecated: card.deprecated,
                    drivers: driverIdsFromFilter(card.args[0].filter),
                };
            });

        const expected = {};
        DEPRECATED_CARD_IDS.forEach((id) => {
            expected[id] = { deprecated: true, drivers: [LOCAL_DRIVER] };
        });

        expect(restricted).toEqual(expected);
    });
    // Cards must live in .homeycompose/flow so they can be offered to more than
    // one driver: HomeyCompose hard-codes a single-driver filter for anything in
    // a driver's own driver.flow.compose.json, and two drivers emitting the same
    // card id is a validation error.
    it('defines every card in .homeycompose/flow, one file per id', () => {
        const found = {};

        TYPES.forEach((type) => {
            found[type] = fs.readdirSync(path.join(ROOT, '.homeycompose', 'flow', type))
                .filter((file) => file.endsWith('.json'))
                .map((file) => path.basename(file, '.json'))
                .sort();
        });

        const expected = {};
        TYPES.forEach((type) => {
            expected[type] = [...CARD_IDS[type]].sort();
        });

        expect(found).toEqual(expected);
    });

    it('names each card file after the card id it declares', () => {
        const mismatched = [];

        TYPES.forEach((type) => {
            const dir = path.join(ROOT, '.homeycompose', 'flow', type);

            fs.readdirSync(dir).filter((file) => file.endsWith('.json')).forEach((file) => {
                const card = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

                if (card.id !== path.basename(file, '.json')) {
                    mismatched.push(`${type}/${file} declares id "${card.id}"`);
                }
            });
        });

        expect(mismatched).toEqual([]);
    });

    it('has no driver-scoped flow cards left', () => {
        const strays = fs.readdirSync(path.join(ROOT, 'drivers'))
            .filter((driver) => fs.existsSync(
                path.join(ROOT, 'drivers', driver, 'driver.flow.compose.json'),
            ));

        expect(strays).toEqual([]);
    });
});
