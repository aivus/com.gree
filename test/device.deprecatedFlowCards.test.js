'use strict';

describe('GreeHVACDevice deprecated hvac_mode_changed trigger', () => {
    let GreeHVACDevice;
    let device;
    let trigger;
    let getArgumentValues;
    let notifyDeprecatedFlowCard;

    beforeEach(() => {
        jest.resetModules();

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => ({ hvacs: [] }));
        jest.doMock('gree-hvac-client', () => ({ PROPERTY: {}, VALUE: {} }));

        jest.doMock('homey', () => ({
            Device: class Device {
                log() {}
                error() {}
            },
        }));

        GreeHVACDevice = require('../drivers/gree_cooper_hunter_hvac/device');

        trigger = jest.fn().mockResolvedValue();
        getArgumentValues = jest.fn().mockResolvedValue([]);
        notifyDeprecatedFlowCard = jest.fn().mockResolvedValue();

        device = new GreeHVACDevice();
        device.log = jest.fn();
        device.error = jest.fn();
        device._flowTriggerHvacModeChanged = { trigger, getArgumentValues };
        device.homey = { app: { _notifyDeprecatedFlowCard: notifyDeprecatedFlowCard } };
    });

    test('fires the trigger with the hvac mode token', async () => {
        await device._triggerHvacModeChanged('cool');

        expect(trigger).toHaveBeenCalledWith(device, { hvac_mode: 'cool' });
    });

    test('notifies about the deprecated card when a Flow uses it', async () => {
        getArgumentValues.mockResolvedValue([{}]);

        await device._triggerHvacModeChanged('heat');

        expect(getArgumentValues).toHaveBeenCalledWith(device);
        expect(notifyDeprecatedFlowCard).toHaveBeenCalledWith('hvac_mode_changed');
    });

    test('does not notify when no Flow uses the card', async () => {
        getArgumentValues.mockResolvedValue([]);

        await device._triggerHvacModeChanged('auto');

        expect(notifyDeprecatedFlowCard).not.toHaveBeenCalled();
    });

    test('swallows errors from the usage check without throwing', async () => {
        getArgumentValues.mockRejectedValue(new Error('boom'));

        await expect(device._triggerHvacModeChanged('cool')).resolves.toBeUndefined();
        expect(device.error).toHaveBeenCalled();
        expect(notifyDeprecatedFlowCard).not.toHaveBeenCalled();
    });
});
