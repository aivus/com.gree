'use strict';

/**
 * Command sequencing for the cloud transport.
 *
 * Writing properties through the cloud is far pickier than over the local
 * protocol, and the rules below are what make a write actually land:
 *
 * 1. Commands must be sent one at a time, each awaiting its confirmation.
 *    Publishing several at once leaves all but the first silently ignored.
 * 2. The order matters: the operating mode first, then temperature, then
 *    everything else, and power last. Turning a unit on before its mode is set
 *    makes it start in whatever mode it happened to remember.
 * 3. The temperature fields have to travel together. A unit ignores the
 *    half-degree fields unless `SetTem` is present in the same command.
 */

// Written first, so the unit is in the right mode before anything else.
const MODE_CODE = 'Mod';

// Written last, so the unit only starts once it is fully configured.
const POWER_CODE = 'Pow';

// These are meaningless on their own and must be written in one command.
const TEMPERATURE_CODES = ['SetTem', 'TemRec', 'SetDeciTem', 'Add0.5', 'TemUn'];

// A temperature command is only sent when it carries the whole-degree value.
const TEMPERATURE_ANCHOR = 'SetTem';

/**
 * Other fields that only work when written together. Sleep mode is gated behind
 * a pair of fields - the switch and the mode - and a unit ignores the switch
 * unless the mode moves with it, so they must not be split into two commands.
 */
const COMPANION_GROUPS = [['SwhSlp', 'SlpMod']];

/**
 * Split vendor properties into the ordered commands they must be sent as.
 *
 * @param {Object<string, string|number>} vendorProperties Vendor code -> value
 * @returns {Array<Object<string, string|number>>} One object per command, in
 *          the order they have to be published
 */
function buildCommandSequence(vendorProperties) {
    const remaining = { ...vendorProperties };
    const commands = [];

    if (MODE_CODE in remaining) {
        commands.push({ [MODE_CODE]: remaining[MODE_CODE] });
        delete remaining[MODE_CODE];
    }

    const temperature = {};
    TEMPERATURE_CODES.forEach((code) => {
        if (code in remaining) {
            temperature[code] = remaining[code];
            delete remaining[code];
        }
    });

    if (TEMPERATURE_ANCHOR in temperature) {
        commands.push(temperature);
    } else {
        // Without SetTem the unit would drop these, so send them individually
        // rather than as a group it cannot interpret.
        Object.entries(temperature).forEach(([code, value]) => {
            commands.push({ [code]: value });
        });
    }

    const power = POWER_CODE in remaining ? remaining[POWER_CODE] : undefined;
    delete remaining[POWER_CODE];

    COMPANION_GROUPS.forEach((group) => {
        const companions = {};

        group.forEach((code) => {
            if (code in remaining) {
                companions[code] = remaining[code];
                delete remaining[code];
            }
        });

        if (Object.keys(companions).length > 0) {
            commands.push(companions);
        }
    });

    Object.entries(remaining).forEach(([code, value]) => {
        commands.push({ [code]: value });
    });

    if (power !== undefined) {
        commands.push({ [POWER_CODE]: power });
    }

    return commands;
}

class CommandQueue {

    /**
     * Runs tasks strictly one after another, in the order they were queued.
     *
     * @param {object} [options]
     * @param {Function} [options.onError] Called with an error a task rejected
     *        with, for logging. The queue keeps running either way.
     */
    constructor({ onError } = {}) {
        this._tail = Promise.resolve();
        this._onError = onError || (() => {});
        this._size = 0;
    }

    get size() {
        return this._size;
    }

    /**
     * Queue a task. Resolves or rejects with the task's own outcome, but a
     * rejection never stops the tasks queued behind it.
     *
     * @param {Function} task Returns a promise
     * @returns {Promise<*>}
     */
    add(task) {
        this._size += 1;

        const result = this._tail.then(() => task());

        // Keep the chain alive regardless of how this task ends, so one failed
        // command cannot wedge the queue for the rest of the session.
        this._tail = result.then(
            () => {},
            (error) => {
                this._onError(error);
            },
        );

        return result.finally(() => {
            this._size -= 1;
        });
    }

}

module.exports = {
    buildCommandSequence,
    CommandQueue,
    MODE_CODE,
    POWER_CODE,
    TEMPERATURE_CODES,
    COMPANION_GROUPS,
};
