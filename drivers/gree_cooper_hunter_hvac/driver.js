'use strict';

const Homey = require('homey');
const finder = require('./network/finder');

class GreeHVACDriver extends Homey.Driver {

    async onInit() {
        this.log('GreeHVACDriver has been inited');
        this._finder = finder;
    }

    async onPair(session) {
        // Devices added manually via static IP during this pair session
        const staticDevices = [];

        session.setHandler('list_devices', async () => {
            const staticIpByMac = {};
            for (const hvac of staticDevices) {
                staticIpByMac[hvac.message.mac] = hvac.remoteInfo.address;
            }

            const found = finder.hvacs.map((hvac) => {
                const device = GreeHVACDriver.hvacToDevice(hvac);
                const staticIp = staticIpByMac[hvac.message.mac];
                if (staticIp) {
                    device.settings = { static_ip: staticIp };
                }
                return device;
            });

            // Include static devices not found via broadcast
            const foundMacs = new Set(found.map((d) => d.data.mac));
            const manual = staticDevices
                .filter((hvac) => !foundMacs.has(hvac.message.mac))
                .map((hvac) => ({
                    ...GreeHVACDriver.hvacToDevice(hvac),
                    settings: { static_ip: hvac.remoteInfo.address },
                }));

            return [...found, ...manual];
        });

        session.setHandler('addStaticDevice', async ({ ip, skipScan, name }) => {
            if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim())) {
                throw new Error('Invalid IP address');
            }

            const cleanIp = ip.trim();

            if (skipScan) {
                const deviceName = (name && name.trim()) || cleanIp;
                const hvac = {
                    message: { cid: cleanIp, mac: cleanIp, name: deviceName },
                    remoteInfo: { address: cleanIp },
                };
                staticDevices.push(hvac);
                return GreeHVACDriver.hvacToDevice(hvac);
            }

            const hvac = await finder.probe(cleanIp);
            staticDevices.push(hvac);
            return GreeHVACDriver.hvacToDevice(hvac);
        });
    }

    static hvacToDevice(hvac) {
        const { message, remoteInfo } = hvac;

        const name = `${message.name} (${remoteInfo.address})`;

        return {
            name,
            data: {
                id: message.cid,
                mac: message.mac,
                // test: 'test',
            },
        };
    }

}

module.exports = GreeHVACDriver;
