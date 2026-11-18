import { describe, expect, it } from 'vitest';
import { contentFromRequest, ValidationError } from '../src/index.js';

// The IP parser is internal; this is what callers see of it: a clientIp is validated and normalized.
function clientIp(ip: string): string {
  return contentFromRequest(new Headers(), { clientIp: ip }).userIp;
}

describe('IPv4', () => {
  it.each(['0.0.0.0', '127.0.0.1', '192.0.2.1', '255.255.255.255'])('accepts %s', (ip) => {
    expect(clientIp(ip)).toBe(ip);
  });

  it.each([
    ['256.0.0.1', 'octet above 255'],
    ['01.2.3.4', 'leading zero'],
    ['1.2.3', 'three octets'],
    ['1.2.3.4.5', 'five octets'],
    ['1.2.3.a', 'non-digit'],
  ])('rejects %s (%s)', (ip) => {
    expect(() => clientIp(ip)).toThrow(ValidationError);
  });
});

describe('IPv6', () => {
  it.each([
    '::',
    '::1',
    '1::',
    '2001:db8::1',
    '2001:0db8:0000:0000:0000:ff00:0042:8329',
    'fe80::1ff:fe23:4567:890a',
    '2001:db8::192.0.2.1',
    '1:2:3:4:5:6:192.0.2.1',
    '1:2:3:4:5:6:7:8',
    '1:2:3:4:5:6:7::',
  ])('accepts %s', (ip) => {
    expect(clientIp(ip)).toBe(ip);
  });

  it.each([
    [':', 'lone colon'],
    [':::', 'triple colon'],
    ['1:2', 'too few groups'],
    ['1:2:3:4:5:6:7', 'seven groups without ::'],
    ['1:2:3:4:5:6:7:8:9', 'nine groups'],
    ['1::2::3', 'two :: runs'],
    ['1:2:3:4:5:6:7:8::', ':: standing in for nothing'],
    ['12345::', 'five hex digits'],
    ['g::1', 'non-hex'],
    ['::ffff:999.999.999.999', 'embedded IPv4 out of range'],
    ['::ffff:1.2.3', 'embedded IPv4 too short'],
    ['fe80::1%eth0', 'zone identifier'],
  ])('rejects %s (%s)', (ip) => {
    expect(() => clientIp(ip)).toThrow(ValidationError);
  });
});

describe('normalization', () => {
  it('collapses IPv4-mapped IPv6 to IPv4', () => {
    expect(clientIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(clientIp('::FFFF:192.0.2.1')).toBe('192.0.2.1');
  });

  it('lowercases IPv6', () => {
    expect(clientIp('ABCD:EF01::1')).toBe('abcd:ef01::1');
  });
});
