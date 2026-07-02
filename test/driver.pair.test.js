'use strict';

describe('GreeHVACDriver.onPair()', () => {
    let GreeHVACDriver;
    let mockFinder;
    let session;
    let handlers;
    let pairedDevices;

    beforeEach(() => {
        jest.resetModules();

        mockFinder = {
            hvacs: [],
            probe: jest.fn(),
        };

        jest.doMock('../drivers/gree_cooper_hunter_hvac/network/finder', () => mockFinder);

        jest.doMock('homey', () => ({
            Driver: class Driver {
                log() {}
            },
        }));

        GreeHVACDriver = require('../drivers/gree_cooper_hunter_hvac/driver');

        handlers = {};
        pairedDevices = [];
        session = {
            setHandler: jest.fn((name, fn) => {
                handlers[name] = fn;
            }),
        };
    });

    function makePairedDevice(mac) {
        return { getMac: jest.fn(() => mac) };
    }

    async function initPair() {
        const driver = new GreeHVACDriver();
        driver.getDevices = jest.fn(() => pairedDevices);
        await driver.onPair(session);
    }

    describe('addStaticDevice', () => {
        test('throws on invalid IP address', async () => {
            await initPair();

            await expect(handlers.addStaticDevice({ ip: 'not-an-ip' }))
                .rejects.toThrow('Invalid IP address');

            await expect(handlers.addStaticDevice({ ip: '' }))
                .rejects.toThrow('Invalid IP address');

            await expect(handlers.addStaticDevice({ ip: '256.168.1.10' }))
                .rejects.toThrow('Invalid IP address');

            await expect(handlers.addStaticDevice({ ip: '192.168.1.999' }))
                .rejects.toThrow('Invalid IP address');
        });

        test('calls finder.probe() when skipScan is false', async () => {
            await initPair();

            mockFinder.probe.mockResolvedValue({
                message: { cid: 'aabb', mac: 'aabb', name: 'MyAC' },
                remoteInfo: { address: '192.168.1.10' },
            });

            await handlers.addStaticDevice({ ip: '192.168.1.10', skipScan: false });

            expect(mockFinder.probe).toHaveBeenCalledWith('192.168.1.10');
        });

        test('returns device info from finder.probe()', async () => {
            await initPair();

            mockFinder.probe.mockResolvedValue({
                message: { cid: 'aabb', mac: 'aabb', name: 'MyAC' },
                remoteInfo: { address: '192.168.1.10' },
            });

            const result = await handlers.addStaticDevice({ ip: '192.168.1.10', skipScan: false });

            expect(result.data.id).toBe('aabb');
            expect(result.data.mac).toBe('aabb');
            expect(result.name).toBe('MyAC (192.168.1.10)');
        });

        test('does NOT call finder.probe() when skipScan is true', async () => {
            await initPair();

            await handlers.addStaticDevice({ ip: '192.168.1.10', skipScan: true });

            expect(mockFinder.probe).not.toHaveBeenCalled();
        });

        test('uses IP as id and name but no MAC when skipScan is true and no name given', async () => {
            await initPair();

            const result = await handlers.addStaticDevice({ ip: '192.168.1.10', skipScan: true, name: '' });

            expect(result.data.id).toBe('192.168.1.10');
            expect(result.data.mac).toBeUndefined();
            expect(result.name).toBe('192.168.1.10 (192.168.1.10)');
            expect(result.settings.static_ip).toBe('192.168.1.10');
        });

        test('uses provided name when skipScan is true and name is given', async () => {
            await initPair();

            const result = await handlers.addStaticDevice({ ip: '192.168.1.10', skipScan: true, name: 'Bedroom AC' });

            expect(result.name).toBe('Bedroom AC (192.168.1.10)');
        });

        test('trims whitespace from IP', async () => {
            await initPair();

            mockFinder.probe.mockResolvedValue({
                message: { cid: 'aabb', mac: 'aabb', name: 'AC' },
                remoteInfo: { address: '192.168.1.10' },
            });

            await handlers.addStaticDevice({ ip: '  192.168.1.10  ', skipScan: false });

            expect(mockFinder.probe).toHaveBeenCalledWith('192.168.1.10');
        });
    });

    describe('list_devices', () => {
        test('returns auto-discovered devices from finder', async () => {
            mockFinder.hvacs = [
                { message: { cid: 'aabb', mac: 'aabb', name: 'LivingRoom' }, remoteInfo: { address: '10.0.0.1' } },
            ];

            await initPair();

            const devices = await handlers.list_devices();

            expect(devices).toHaveLength(1);
            expect(devices[0].data.mac).toBe('aabb');
        });

        test('includes static device added during session', async () => {
            mockFinder.hvacs = [];
            await initPair();

            mockFinder.probe.mockResolvedValue({
                message: { cid: 'ccdd', mac: 'ccdd', name: 'Bedroom' },
                remoteInfo: { address: '10.0.0.2' },
            });
            await handlers.addStaticDevice({ ip: '10.0.0.2', skipScan: false });

            const devices = await handlers.list_devices();

            expect(devices).toHaveLength(1);
            expect(devices[0].data.mac).toBe('ccdd');
        });

        test('attaches static_ip setting to manually added devices', async () => {
            mockFinder.hvacs = [];
            await initPair();

            mockFinder.probe.mockResolvedValue({
                message: { cid: 'ccdd', mac: 'ccdd', name: 'Bedroom' },
                remoteInfo: { address: '10.0.0.2' },
            });
            await handlers.addStaticDevice({ ip: '10.0.0.2', skipScan: false });

            const devices = await handlers.list_devices();

            expect(devices[0].settings.static_ip).toBe('10.0.0.2');
        });

        test('deduplicates when static device was also found via broadcast', async () => {
            mockFinder.hvacs = [
                { message: { cid: 'ccdd', mac: 'ccdd', name: 'Bedroom' }, remoteInfo: { address: '10.0.0.2' } },
            ];
            await initPair();

            // Same device added manually
            mockFinder.probe.mockResolvedValue({
                message: { cid: 'ccdd', mac: 'ccdd', name: 'Bedroom' },
                remoteInfo: { address: '10.0.0.2' },
            });
            await handlers.addStaticDevice({ ip: '10.0.0.2', skipScan: false });

            const devices = await handlers.list_devices();

            expect(devices).toHaveLength(1);
        });

        test('excludes broadcast devices that are already paired (by resolved MAC)', async () => {
            // Device was paired via "Skip UDP scan" (data.mac is an IP),
            // but its real MAC was resolved on first connect
            pairedDevices = [makePairedDevice('aabb')];
            mockFinder.hvacs = [
                { message: { cid: 'aabb', mac: 'aabb', name: 'Living' }, remoteInfo: { address: '10.0.0.1' } },
                { message: { cid: 'ccdd', mac: 'ccdd', name: 'Bedroom' }, remoteInfo: { address: '10.0.0.2' } },
            ];

            await initPair();

            const devices = await handlers.list_devices();

            expect(devices).toHaveLength(1);
            expect(devices[0].data.mac).toBe('ccdd');
        });

        test('excludes manually added devices that are already paired', async () => {
            pairedDevices = [makePairedDevice('ccdd')];
            await initPair();

            mockFinder.probe.mockResolvedValue({
                message: { cid: 'ccdd', mac: 'ccdd', name: 'Bedroom' },
                remoteInfo: { address: '10.0.0.2' },
            });
            await handlers.addStaticDevice({ ip: '10.0.0.2', skipScan: false });

            const devices = await handlers.list_devices();

            expect(devices).toHaveLength(0);
        });

        test('returns both broadcast and unique static devices', async () => {
            mockFinder.hvacs = [
                { message: { cid: 'aabb', mac: 'aabb', name: 'Living' }, remoteInfo: { address: '10.0.0.1' } },
            ];
            await initPair();

            await handlers.addStaticDevice({ ip: '10.0.0.2', skipScan: true, name: 'Bedroom' });

            const devices = await handlers.list_devices();

            expect(devices).toHaveLength(2);
        });

        test('always includes skipScan devices since they cannot be deduplicated', async () => {
            pairedDevices = [makePairedDevice('aabb')];
            await initPair();

            await handlers.addStaticDevice({ ip: '10.0.0.2', skipScan: true, name: 'Bedroom' });

            const devices = await handlers.list_devices();

            expect(devices).toHaveLength(1);
            expect(devices[0].data.id).toBe('10.0.0.2');
        });
    });
});
