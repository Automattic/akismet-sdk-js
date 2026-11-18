/**
 * Runtime-neutral IP address parsing. `node:net` is unavailable on edge runtimes,
 * and regex-only validators get IPv6 wrong (embedded IPv4, `::` rules, octet bounds).
 */

const IPV4_OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/i;
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
const BRACKETED_IPV6 = /^\[([^\]]+)\](?::\d+)?$/;

/** Dotted-quad IPv4 with octets 0-255 and no leading zeros. */
function isIPv4(value: string): boolean {
  const octets = value.split('.');
  return octets.length === 4 && octets.every((octet) => IPV4_OCTET.test(octet));
}

/**
 * RFC 4291 text form: eight hex groups, at most one `::` run, optional embedded
 * IPv4 in the final 32 bits. Zone identifiers (`%eth0`) are rejected because they
 * have no meaning off the originating host.
 */
function isIPv6(value: string): boolean {
  if (value === '' || value.includes('%')) {
    return false;
  }

  let text = value;
  const lastColon = value.lastIndexOf(':');
  const tail = value.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (lastColon === -1 || !isIPv4(tail)) {
      return false;
    }
    // An embedded IPv4 address occupies the last two 16-bit groups.
    text = `${value.slice(0, lastColon + 1)}0:0`;
  }

  const halves = text.split('::');
  if (halves.length > 2) {
    return false;
  }

  if (halves.length === 2) {
    const [head = '', rest = ''] = halves;
    const groups = [...splitGroups(head), ...splitGroups(rest)];
    // `::` must stand in for at least one group.
    return groups.length <= 7 && groups.every((group) => IPV6_GROUP.test(group));
  }

  const groups = text.split(':');
  return groups.length === 8 && groups.every((group) => IPV6_GROUP.test(group));
}

function splitGroups(part: string): string[] {
  return part === '' ? [] : part.split(':');
}

export function isIP(value: string): boolean {
  return isIPv4(value) || isIPv6(value);
}

/**
 * Canonical form for transmission: IPv4-mapped IPv6 (`::ffff:192.0.2.1`, which Node
 * reports for IPv4 peers on dual-stack sockets) collapses to the IPv4 address, and
 * IPv6 hex is lowercased. Returns the input unchanged when it is not an IP address.
 */
export function normalizeIp(value: string): string {
  const mapped = IPV4_MAPPED.exec(value);
  if (mapped?.[1] !== undefined && isIPv4(mapped[1])) {
    return mapped[1];
  }
  return isIPv6(value) ? value.toLowerCase() : value;
}

/**
 * The address in a `host:port` or `[ipv6]:port` entry, with IPv6 brackets removed; any
 * other text unchanged. Some proxies, Azure App Service among them, append the client's
 * source port in X-Forwarded-For.
 */
export function withoutPort(entry: string): string {
  return IPV4_WITH_PORT.exec(entry)?.[1] ?? BRACKETED_IPV6.exec(entry)?.[1] ?? entry;
}
