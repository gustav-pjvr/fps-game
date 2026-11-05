import { describe, expect, it } from 'vitest';
import { clientIp, ipGroup } from './clientIp.ts';

describe('clientIp: X-Forwarded-For only from the local proxy', () => {
  it('uses the socket address when the peer is not 127.0.0.1, whatever the header says', () => {
    expect(clientIp('203.0.113.9', '198.51.100.1')).toBe('203.0.113.9');
    expect(clientIp('2001:db8::1', '198.51.100.1')).toBe('2001:db8::1');
    expect(clientIp('::1', '198.51.100.1')).toBe('::1');
    expect(clientIp('10.0.0.2', undefined)).toBe('10.0.0.2');
  });

  it('from 127.0.0.1 takes the last entry, the one the proxy appended', () => {
    expect(clientIp('127.0.0.1', '198.51.100.1')).toBe('198.51.100.1');
    expect(clientIp('::ffff:127.0.0.1', '198.51.100.1')).toBe('198.51.100.1');
    expect(clientIp('127.0.0.1', '1.1.1.1, 198.51.100.1')).toBe('198.51.100.1');
    expect(clientIp('127.0.0.1', ['1.1.1.1', '2001:db8::7'])).toBe('2001:db8::7');
  });

  it('from 127.0.0.1 without the header is a local client (dev)', () => {
    expect(clientIp('127.0.0.1', undefined)).toBe('127.0.0.1');
    expect(clientIp('127.0.0.1', ' , ')).toBe('127.0.0.1');
  });

  it('refuses a proxied request whose last entry is not an address', () => {
    expect(clientIp('127.0.0.1', '198.51.100.1, unknown')).toBeNull();
    expect(clientIp('127.0.0.1', '198.51.100.1:443')).toBeNull();
    expect(clientIp(undefined, undefined)).toBeNull();
  });
});

describe('ipGroup: IPv4 as is, IPv6 by /64', () => {
  it('keeps IPv4, also when written IPv4-mapped', () => {
    expect(ipGroup('203.0.113.9')).toBe('203.0.113.9');
    expect(ipGroup('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(ipGroup('::FFFF:203.0.113.9')).toBe('203.0.113.9');
  });

  it('groups every address of one /64 together, however it is written', () => {
    const group = '2001:db8:1:2::/64';
    for (const address of ['2001:db8:1:2::1', '2001:db8:1:2:ffff:ffff:ffff:ffff', '2001:0DB8:0001:0002:0:0:0:9', '2001:db8:1:2:a:b:c:d%eth0', '2001:db8:1:2::1.2.3.4']) {
      expect(ipGroup(address), address).toBe(group);
    }
  });

  it('keeps different /64s apart', () => {
    expect(ipGroup('2001:db8:1:2::1')).not.toBe(ipGroup('2001:db8:1:3::1'));
    expect(ipGroup('::1')).toBe('0:0:0:0::/64');
    expect(ipGroup('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
    expect(ipGroup('fe80::1')).toBe('fe80:0:0:0::/64');
  });
});
