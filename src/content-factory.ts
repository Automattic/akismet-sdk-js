import { type Content, nullIfEmpty, validateContent } from './content.js';
import { invalidValue } from './errors/factories.js';
import { type FormSource, honeypotFromForm } from './honeypot.js';
import { isIP, normalizeIp, withoutPort } from './ip.js';

/**
 * How the author's client IP is derived.
 *
 * The default trusts only the connecting peer. Behind reverse proxies, state how
 * many there are and the SDK walks `X-Forwarded-For` right to left past them.
 */
export interface ClientIpOptions {
  /**
   * Address of the peer that connected to your server. Read from the socket of a Node
   * request when omitted. A Web `Request` or bare `Headers` has no socket, so pass it,
   * or pass `clientIp`, or set `trustedProxyHops`.
   */
  remoteAddress?: string | undefined;
  /**
   * Number of reverse proxies between the client and your server, counting the one
   * that connected to you. `0` (default) ignores forwarding headers entirely.
   */
  trustedProxyHops?: number | undefined;
  /**
   * Client IP you already resolved, for example from a header your ingress is
   * known to set authoritatively (`CF-Connecting-IP` behind Cloudflare). Takes
   * precedence over every other option.
   */
  clientIp?: string | null | undefined;
}

export interface ContentFromRequestOptions extends ClientIpOptions {
  /**
   * Request headers to forward to Akismet as server variables, by header name.
   * Each is sent under its CGI name (`accept-language` → `HTTP_ACCEPT_LANGUAGE`).
   * Nothing is forwarded by default; the SDK cannot know which of your headers
   * carry credentials. Headers the server reads as the client IP (`x-forwarded-for`,
   * `x-real-ip`, `forwarded` and similar) throw `ValidationError`.
   */
  forwardHeaders?: readonly string[] | undefined;
  /**
   * The submitted form, parsed: `FormData` or a body object. When set, the honeypot
   * the form names in `akismet_honeypot_name` is read from it.
   */
  form?: FormSource | undefined;
  /** Hidden field that names the honeypot. Defaults to `akismet_honeypot_name`. */
  honeypotNameField?: string | undefined;
}

/**
 * The parts of Node's `http.IncomingMessage` the builders read. Declared here rather than
 * imported from `node:http` so the published typings compile without `@types/node`.
 */
export interface NodeRequestLike {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | undefined } | undefined;
}

/**
 * Where the request details come from: a Web `Request` (Fetch, Hono, Next.js route
 * handlers, Workers), a Node request (Express, Fastify's `request.raw`, `node:http`), or
 * bare `Headers` where there is no request object (Next.js Server Actions).
 */
export type RequestSource = Request | NodeRequestLike | Headers;

type HeaderReader = (name: string) => string;

/** `raw` is what the error quotes, so an operator sees the header as the proxy sent it. */
function validatedIp(value: string, field: string, raw = value): string {
  const normalized = normalizeIp(value.trim());
  if (!isIP(normalized)) {
    throw invalidValue(field, `"${raw}" is not a valid IP address`);
  }
  return normalized;
}

function resolveClientIp(
  readHeader: HeaderReader,
  socket: string | undefined,
  options: ClientIpOptions
): string {
  const explicit = nullIfEmpty(options.clientIp);
  if (explicit !== null) {
    return validatedIp(explicit, 'clientIp');
  }

  const hops = options.trustedProxyHops ?? 0;
  if (!Number.isSafeInteger(hops) || hops < 0) {
    throw invalidValue('trustedProxyHops', 'must be a non-negative integer');
  }

  const remote = nullIfEmpty(options.remoteAddress ?? socket);
  if (hops === 0) {
    if (remote === null) {
      throw invalidValue(
        'remoteAddress',
        'is required to identify the client; pass remoteAddress, clientIp, or trustedProxyHops'
      );
    }
    return validatedIp(remote, 'remoteAddress');
  }

  // Each proxy appends the address that connected to it, so the chain reads
  // client → proxy 1 → … → proxy N-1, and the connecting peer is proxy N.
  // The last `hops` addresses belong to proxies; the one before them is the client.
  const chain = readHeader('x-forwarded-for')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (remote !== null) {
    chain.push(remote);
  }
  const clientIndex = chain.length - hops - (remote === null ? 0 : 1);
  const candidate = chain[clientIndex];
  if (candidate === undefined) {
    throw invalidValue(
      'trustedProxyHops',
      `expects at least ${String(hops)} forwarding hop(s) but X-Forwarded-For holds too few entries; check the proxy count`
    );
  }
  return validatedIp(withoutPort(candidate), 'x-forwarded-for', candidate);
}

function cgiName(header: string): string {
  return `HTTP_${header.toUpperCase().replaceAll('-', '_')}`;
}

// The server may replace the author IP with these forwarded headers; the trust decision
// belongs to trustedProxyHops, so they are never forwarded. Compared by CGI name, which is
// what the server reads, so `x_real_ip` cannot pass for `x-real-ip`.
const IP_OVERRIDE_HEADERS: ReadonlySet<string> = new Set(
  [
    'x-real-ip',
    'x-forwarded-for',
    'cf-connecting-ip',
    'true-client-ip',
    'akamai-origin-hop',
    'x-varnish',
    'forwarded',
  ].map((name) => cgiName(name))
);

function forwardedServerVariables(
  readHeader: HeaderReader,
  names: readonly string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    if (IP_OVERRIDE_HEADERS.has(cgiName(name))) {
      throw invalidValue(
        'forwardHeaders',
        `cannot forward ${JSON.stringify(name)}; the client IP comes from trustedProxyHops or clientIp`
      );
    }
    const value = readHeader(name);
    if (value !== '') {
      out[cgiName(name)] = value;
    }
  }
  return out;
}

// By shape, not instanceof: a second copy of undici, a polyfill, or another realm brings
// its own Headers class, and misreading one as a Node object would drop every header.
function hasGet(value: unknown): value is { get(name: string): string | null } {
  return typeof (value as { get?: unknown } | null)?.get === 'function';
}

function readerFor(source: RequestSource): {
  readHeader: HeaderReader;
  socket: string | undefined;
} {
  // Bare Headers has no `headers` property; Express requests have a `get()` of their own,
  // so the shape check must look at `headers`, not at the source.
  if (!('headers' in source)) {
    if (!hasGet(source)) {
      throw invalidValue('source', 'expected a Web Request, a Node request, or Headers');
    }
    return { readHeader: (name) => source.get(name) ?? '', socket: undefined };
  }
  const { headers } = source;
  if (hasGet(headers)) {
    return { readHeader: (name) => headers.get(name) ?? '', socket: undefined };
  }
  return {
    readHeader: (name) => {
      const value = headers[name.toLowerCase()];
      if (value === undefined) {
        return '';
      }
      return Array.isArray(value) ? value.join(', ') : value;
    },
    socket: (source as NodeRequestLike).socket?.remoteAddress,
  };
}

/**
 * Build {@link Content} from what the incoming request says about its author: client IP,
 * user agent, referrer, allowlisted headers, and the honeypot when `form` is set. Spread
 * the submitted fields over the result, or use `akismet.forRequest()` to do it for you.
 */
export function contentFromRequest(
  source: RequestSource,
  options: ContentFromRequestOptions = {}
): Content {
  const { readHeader, socket } = readerFor(source);
  const content: Content = {
    userIp: resolveClientIp(readHeader, socket, options),
    userAgent: nullIfEmpty(readHeader('user-agent')),
    referrer: nullIfEmpty(readHeader('referer')),
    serverVariables: forwardedServerVariables(readHeader, options.forwardHeaders ?? []),
    ...(options.form ? honeypotFromForm(options.form, options.honeypotNameField) : {}),
  };
  validateContent(content);
  return content;
}
