'use strict';

const Homey = require('homey');
const finder = require('./network/finder');
const { isValidIpv4 } = require('../../utils');

class GreeHVACDriver extends Homey.Driver {

    async onInit() {
        this.log('GreeHVACDriver has been inited');
        this._finder = finder;
    }

    async onPair(session) {
        // Device descriptors added manually via static IP during this pair session
        const staticDevices = [];

        session.setHandler('list_devices', async () => {
            const staticIpByMac = {};
            for (const device of staticDevices) {
                if (device.data.mac) {
                    staticIpByMac[device.data.mac] = device.settings.static_ip;
                }
            }

            // MACs of already paired devices. Devices paired via "Skip UDP scan"
            // have no MAC in their device data, so Homey cannot match them
            // when they show up in the broadcast results with their real MAC.
            const pairedMacs = new Set(this.getDevices().map((device) => device.getMac()));

            const found = finder.hvacs.filter((hvac) => !pairedMacs.has(hvac.message.mac)).map((hvac) => {
                const device = GreeHVACDriver.hvacToDevice(hvac);
                const staticIp = staticIpByMac[hvac.message.mac];
                if (staticIp) {
                    device.settings = { static_ip: staticIp };
                }
                return device;
            });

            // Include static devices not found via broadcast
            const foundMacs = new Set(found.map((d) => d.data.mac));
            const manual = staticDevices.filter((device) => {
                // Devices without a known MAC ("Skip UDP scan") cannot be deduplicated
                if (!device.data.mac) {
                    return true;
                }

                return !foundMacs.has(device.data.mac) && !pairedMacs.has(device.data.mac);
            });

            return [...found, ...manual];
        });

        session.setHandler('addStaticDevice', async ({ ip, skipScan, name }) => {
            if (!isValidIpv4(ip)) {
                throw new Error('Invalid IP address');
            }

            const cleanIp = ip.trim();

            let device;
            if (skipScan) {
                // The device cannot be probed, so its MAC is unknown at pair time.
                // Use the IP as the unique device id; the real MAC is resolved
                // and stored by the device on the first successful connection.
                const deviceName = (name && name.trim()) || cleanIp;
                device = {
                    name: `${deviceName} (${cleanIp})`,
                    data: {
                        id: cleanIp,
                    },
                };
            } else {
                device = GreeHVACDriver.hvacToDevice(await finder.probe(cleanIp));
            }

            device.settings = { static_ip: cleanIp };
            staticDevices.push(device);
            return device;
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
