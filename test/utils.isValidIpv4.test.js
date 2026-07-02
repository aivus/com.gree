'use strict';

const { isValidIpv4 } = require('../utils');

describe('isValidIpv4()', () => {
    test('accepts valid IPv4 addresses', () => {
        const validIps = [
            '192.168.1.1',
            '10.0.0.5',
            '0.0.0.0',
            '255.255.255.255',
            '  192.168.1.1  ',
        ];

        for (const ip of validIps) {
            expect(isValidIpv4(ip)).toBe(true);
        }
    });

    test('rejects invalid IPv4 addresses', () => {
        const invalidIps = [
            '',
            null,
            undefined,
            'not-an-ip',
            '192.168.1',
            '192.168.1.1.1',
            '256.1.1.1',
            '192.168.1.999',
            '192.168.-1.1',
            '01.2.3.4',
            '1.2.3.04',
            '1.2.3.4a',
        ];

        for (const ip of invalidIps) {
            expect(isValidIpv4(ip)).toBe(false);
        }
    });
});
