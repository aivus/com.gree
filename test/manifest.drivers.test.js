'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const LOCAL_DRIVER = 'gree_cooper_hunter_hvac';
const CLOUD_DRIVER = 'gree_cloud_hvac';

function readAppJson() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
}

function driver(id) {
    const found = readAppJson().drivers.find((candidate) => candidate.id === id);

    if (!found) {
        throw new Error(`Driver ${id} is missing from app.json`);
    }

    return found;
}

describe('drivers in the generated app.json', () => {
    it('ships both the local and the cloud driver', () => {
        const ids = readAppJson().drivers.map((candidate) => candidate.id).sort();

        expect(ids).toEqual([CLOUD_DRIVER, LOCAL_DRIVER].sort());
    });

    // The two drivers share the app's capabilities and Flow cards, so their
    // capability sets must not drift apart.
    it('exposes the same capabilities in both drivers', () => {
        expect(driver(CLOUD_DRIVER).capabilities).toEqual(driver(LOCAL_DRIVER).capabilities);
    });

    it('bounds the target temperature the same way in both drivers', () => {
        expect(driver(CLOUD_DRIVER).capabilitiesOptions.target_temperature)
            .toEqual(driver(LOCAL_DRIVER).capabilitiesOptions.target_temperature);
    });

    it('offers the same thermostat modes in both drivers', () => {
        const modeIds = (id) => driver(id).capabilitiesOptions.thermostat_mode.values
            .map((value) => value.id);

        expect(modeIds(CLOUD_DRIVER)).toEqual(modeIds(LOCAL_DRIVER));
    });

    it('uses the air conditioning device class for both drivers', () => {
        expect(driver(CLOUD_DRIVER).class).toBe('airconditioning');
        expect(driver(LOCAL_DRIVER).class).toBe('airconditioning');
    });

    it('declares the cloud driver as cloud-connected', () => {
        expect(driver(CLOUD_DRIVER).connectivity).toEqual(['cloud']);
    });
});

describe('driver assets and views', () => {
    const drivers = [LOCAL_DRIVER, CLOUD_DRIVER];

    it('has both images on disk for every driver', () => {
        const missing = [];

        drivers.forEach((id) => {
            Object.values(driver(id).images).forEach((image) => {
                if (!fs.existsSync(path.join(ROOT, image))) {
                    missing.push(`${id}: ${image}`);
                }
            });
        });

        expect(missing).toEqual([]);
    });

    it('has an icon on disk for every driver', () => {
        const missing = drivers.filter((id) => !fs.existsSync(
            path.join(ROOT, 'drivers', id, 'assets', 'icon.svg'),
        ));

        expect(missing).toEqual([]);
    });

    // homey-lib checks that pair views exist, but not repair views, so a typo
    // in a repair view id would ship a blank screen.
    it('has an HTML file for every custom pair and repair view', () => {
        const missing = [];

        drivers.forEach((id) => {
            [['pair', driver(id).pair], ['repair', driver(id).repair]].forEach(([kind, views]) => {
                (views || []).forEach((view) => {
                    if (view.template) {
                        return;
                    }

                    const file = path.join(ROOT, 'drivers', id, kind, `${view.id}.html`);
                    if (!fs.existsSync(file)) {
                        missing.push(`${id}/${kind}/${view.id}.html`);
                    }
                });
            });
        });

        expect(missing).toEqual([]);
    });

    it('gives the cloud driver a repair view, so a dead session is recoverable', () => {
        // Without one the only recovery is delete and re-pair, which destroys
        // every Flow referencing the device.
        expect(driver(CLOUD_DRIVER).repair).toEqual([{ id: 'relogin' }]);
    });

    it('points every pair navigation target at a view that exists', () => {
        const dangling = [];

        drivers.forEach((id) => {
            const views = driver(id).pair || [];
            const ids = new Set(views.map((view) => view.id));

            views.forEach((view) => {
                Object.values(view.navigation || {}).forEach((target) => {
                    if (!ids.has(target)) {
                        dangling.push(`${id}: ${view.id} -> ${target}`);
                    }
                });
            });
        });

        expect(dangling).toEqual([]);
    });
});

describe('cloud driver settings', () => {
    const settingIds = () => driver(CLOUD_DRIVER).settings
        .flatMap((group) => group.children.map((child) => child.id));

    it('drops the local-network settings', () => {
        expect(settingIds()).not.toContain('static_ip');
        expect(settingIds()).not.toContain('polling_timeout');
    });

    it('keeps the configurable minimum target temperature', () => {
        expect(settingIds()).toContain('min_target_temperature');
    });

    it('polls far less often than the local driver, to stay within cloud limits', () => {
        const interval = (id) => driver(id).settings
            .flatMap((group) => group.children)
            .find((child) => child.id === 'polling_interval');

        expect(interval(CLOUD_DRIVER).value).toBeGreaterThan(interval(LOCAL_DRIVER).value * 10);
        expect(interval(CLOUD_DRIVER).min).toBeGreaterThanOrEqual(30000);
    });

    it('shows which account and device it is bound to', () => {
        expect(settingIds()).toEqual(expect.arrayContaining([
            'account_email', 'account_region', 'device_mac',
        ]));
    });
});
