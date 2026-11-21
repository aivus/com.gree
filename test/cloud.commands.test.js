'use strict';

const { buildCommandSequence, CommandQueue } = require('../drivers/gree_cloud_hvac/network/commands');

describe('buildCommandSequence()', () => {
    it('sends the mode first and the power last', () => {
        expect(buildCommandSequence({ Pow: 1, Mod: 4, Lig: 1 })).toEqual([
            { Mod: 4 },
            { Lig: 1 },
            { Pow: 1 },
        ]);
    });

    it('keeps the temperature fields together in one command', () => {
        // A unit ignores the half-degree fields unless SetTem travels with them.
        expect(buildCommandSequence({
            SetTem: 22, TemRec: 0, SetDeciTem: 5, 'Add0.5': 1, TemUn: 0,
        })).toEqual([
            {
                SetTem: 22, TemRec: 0, SetDeciTem: 5, 'Add0.5': 1, TemUn: 0,
            },
        ]);
    });

    it('places the temperature group after the mode and before other fields', () => {
        expect(buildCommandSequence({
            Lig: 1, Pow: 1, SetTem: 20, Mod: 1,
        })).toEqual([
            { Mod: 1 },
            { SetTem: 20 },
            { Lig: 1 },
            { Pow: 1 },
        ]);
    });

    it('sends half-degree fields separately when no whole degree is given', () => {
        // Grouping them without SetTem would produce a command the unit drops.
        expect(buildCommandSequence({ TemRec: 1, 'Add0.5': 1 })).toEqual([
            { TemRec: 1 },
            { 'Add0.5': 1 },
        ]);
    });

    it('emits one command per remaining property', () => {
        expect(buildCommandSequence({ Lig: 1, Tur: 0, Health: 1 })).toEqual([
            { Lig: 1 },
            { Tur: 0 },
            { Health: 1 },
        ]);
    });

    it('handles turning a unit off as a single command', () => {
        expect(buildCommandSequence({ Pow: 0 })).toEqual([{ Pow: 0 }]);
    });

    it('preserves a zero power value rather than dropping it', () => {
        expect(buildCommandSequence({ Mod: 1, Pow: 0 })).toEqual([{ Mod: 1 }, { Pow: 0 }]);
    });

    it('returns nothing for no properties', () => {
        expect(buildCommandSequence({})).toEqual([]);
    });

    it('does not mutate its input', () => {
        const input = { Pow: 1, Mod: 4, SetTem: 22 };
        buildCommandSequence(input);

        expect(input).toEqual({ Pow: 1, Mod: 4, SetTem: 22 });
    });
});

describe('CommandQueue', () => {
    it('runs tasks one at a time, in order', async () => {
        const queue = new CommandQueue();
        const order = [];

        const slow = () => new Promise((resolve) => {
            setImmediate(() => {
                order.push('first');
                resolve('a');
            });
        });

        const fast = async () => {
            order.push('second');
            return 'b';
        };

        const results = await Promise.all([queue.add(slow), queue.add(fast)]);

        expect(order).toEqual(['first', 'second']);
        expect(results).toEqual(['a', 'b']);
    });

    it('never overlaps two tasks', async () => {
        const queue = new CommandQueue();
        let running = 0;
        let overlapped = false;

        const task = () => new Promise((resolve) => {
            running += 1;
            if (running > 1) {
                overlapped = true;
            }
            setImmediate(() => {
                running -= 1;
                resolve();
            });
        });

        await Promise.all([queue.add(task), queue.add(task), queue.add(task)]);

        expect(overlapped).toBe(false);
    });

    it('propagates a task rejection to its own caller', async () => {
        const queue = new CommandQueue();

        await expect(queue.add(async () => {
            throw new Error('nope');
        })).rejects.toThrow('nope');
    });

    it('keeps running after a task fails', async () => {
        const errors = [];
        const queue = new CommandQueue({ onError: (error) => errors.push(error.message) });

        const failed = queue.add(async () => {
            throw new Error('nope');
        });
        const after = queue.add(async () => 'still here');

        await expect(failed).rejects.toThrow('nope');
        await expect(after).resolves.toBe('still here');
        expect(errors).toEqual(['nope']);
    });

    it('reports how many tasks are outstanding', async () => {
        const queue = new CommandQueue();
        expect(queue.size).toBe(0);

        const pending = queue.add(async () => 'done');
        expect(queue.size).toBe(1);

        await pending;
        expect(queue.size).toBe(0);
    });
});

describe('buildCommandSequence() companion fields', () => {
    it('keeps the sleep switch and its mode in one command', () => {
        // A unit ignores SwhSlp unless SlpMod moves with it, so splitting them
        // into two commands makes sleep mode silently do nothing.
        expect(buildCommandSequence({ SwhSlp: 1, SlpMod: 1 })).toEqual([{ SwhSlp: 1, SlpMod: 1 }]);
    });

    it('keeps the sleep pair together and still sends power last', () => {
        expect(buildCommandSequence({ SwhSlp: 0, SlpMod: 0, Pow: 1 })).toEqual([
            { SwhSlp: 0, SlpMod: 0 },
            { Pow: 1 },
        ]);
    });

    it('orders mode, temperature, companions, others and power', () => {
        expect(buildCommandSequence({
            Lig: 1, SwhSlp: 1, SlpMod: 1, Mod: 4, SetTem: 22, Pow: 1,
        })).toEqual([
            { Mod: 4 },
            { SetTem: 22 },
            { SwhSlp: 1, SlpMod: 1 },
            { Lig: 1 },
            { Pow: 1 },
        ]);
    });

    it('sends a lone companion field on its own', () => {
        expect(buildCommandSequence({ SlpMod: 1 })).toEqual([{ SlpMod: 1 }]);
    });
});
