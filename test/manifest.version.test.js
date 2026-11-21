'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'locales');

function readJson(...segments) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, ...segments), 'utf8'));
}

describe('app version', () => {
    // The root app.json is generated from .homeycompose, but version bumps are
    // applied by hand (see the "Bump vX.Y.Z" commits), so the two can drift.
    it('is identical in .homeycompose/app.json and the generated app.json', () => {
        expect(readJson('app.json').version).toBe(readJson('.homeycompose', 'app.json').version);
    });

    it('has a changelog entry for the current version', () => {
        const { version } = readJson('.homeycompose', 'app.json');

        expect(Object.keys(readJson('.homeychangelog.json'))).toContain(version);
    });

    it('has a changelog entry translated into every supported locale', () => {
        const { version } = readJson('.homeycompose', 'app.json');
        const languages = fs.readdirSync(LOCALES_DIR)
            .filter((file) => file.endsWith('.json'))
            .map((file) => path.basename(file, '.json'))
            .sort();

        expect(Object.keys(readJson('.homeychangelog.json')[version]).sort()).toEqual(languages);
    });
});
