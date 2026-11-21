'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

/**
 * Collect every leaf key of a nested object as a dot-separated path.
 *
 * @param {object} object
 * @param {string} [prefix]
 * @returns {string[]}
 */
function flattenKeys(object, prefix = '') {
    return Object.entries(object).flatMap(([key, value]) => {
        const keyPath = prefix ? `${prefix}.${key}` : key;

        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            return flattenKeys(value, keyPath);
        }

        return [keyPath];
    });
}

/**
 * Collect the dot-separated paths of all empty or whitespace-only strings.
 *
 * @param {object} object
 * @param {string} [prefix]
 * @returns {string[]}
 */
function findEmptyStrings(object, prefix = '') {
    return Object.entries(object).flatMap(([key, value]) => {
        const keyPath = prefix ? `${prefix}.${key}` : key;

        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            return findEmptyStrings(value, keyPath);
        }

        return typeof value === 'string' && value.trim() === '' ? [keyPath] : [];
    });
}

function readLocale(language) {
    return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), 'utf8'));
}

function listLanguages() {
    return fs.readdirSync(LOCALES_DIR)
        .filter((file) => file.endsWith('.json'))
        .map((file) => path.basename(file, '.json'));
}

describe('locales', () => {
    it('includes English', () => {
        expect(listLanguages()).toContain('en');
    });

    // "homey app validate" only checks that a locale file parses and that its
    // name is a known language code - it does NOT compare keys between locales.
    // A key added to en.json alone would silently fall back to the key name in
    // every other language, so guard the parity here instead.
    it('has exactly the same keys in every language as in en.json', () => {
        const expectedKeys = flattenKeys(readLocale('en')).sort();
        const differing = {};

        listLanguages().filter((language) => language !== 'en').forEach((language) => {
            const keys = flattenKeys(readLocale(language)).sort();

            if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
                differing[language] = {
                    missing: expectedKeys.filter((key) => !keys.includes(key)),
                    unexpected: keys.filter((key) => !expectedKeys.includes(key)),
                };
            }
        });

        expect(differing).toEqual({});
    });

    it('has no empty strings in any language', () => {
        const empty = {};

        listLanguages().forEach((language) => {
            const keys = findEmptyStrings(readLocale(language));

            if (keys.length > 0) {
                empty[language] = keys;
            }
        });

        expect(empty).toEqual({});
    });
});
