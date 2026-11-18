import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { type Content, contentFromRequest, ValidationError } from '../src/index.js';
import { clientOver, clientWith, FEEDBACK_SUCCESS_BODY, sentBody } from './wire.js';

function webRequest(headers: Record<string, string>): Request {
  return new Request('https://example.com/submit', { headers });
}

function nodeRequest(headers: Record<string, string>, remoteAddress?: string): IncomingMessage {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value: remoteAddress });
  const req = new IncomingMessage(socket);
  req.headers = headers;
  return req;
}

describe('client IP resolution', () => {
  it('uses the connecting peer and ignores X-Forwarded-For by default', () => {
    const c = contentFromRequest(webRequest({ 'x-forwarded-for': '9.9.9.9' }), {
      remoteAddress: '10.0.0.1',
    });
    expect(c.userIp).toBe('10.0.0.1');
  });

  it('requires a peer address when there are no trusted hops', () => {
    expect(() => contentFromRequest(webRequest({ 'x-forwarded-for': '9.9.9.9' }))).toThrow(
      ValidationError
    );
  });

  it('walks X-Forwarded-For right to left past the trusted hops', () => {
    const c = contentFromRequest(webRequest({ 'x-forwarded-for': '203.0.113.5, 10.0.0.2' }), {
      remoteAddress: '10.0.0.1',
      trustedProxyHops: 2,
    });
    expect(c.userIp).toBe('203.0.113.5');
  });

  it('is not fooled by client-prepended X-Forwarded-For entries', () => {
    const c = contentFromRequest(
      webRequest({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.5' }),
      { remoteAddress: '10.0.0.1', trustedProxyHops: 1 }
    );
    expect(c.userIp).toBe('203.0.113.5');
  });

  it('counts the platform ingress as a hop when no peer address is available', () => {
    const c = contentFromRequest(webRequest({ 'x-forwarded-for': '203.0.113.5' }), {
      trustedProxyHops: 1,
    });
    expect(c.userIp).toBe('203.0.113.5');
  });

  // Azure App Service, among others, appends the client's source port.
  it.each([
    ['203.0.113.5:5678', '203.0.113.5'],
    ['[2001:db8::1]:443', '2001:db8::1'],
    ['[2001:db8::1]', '2001:db8::1'],
  ])('strips the port from X-Forwarded-For entry %s', (entry, ip) => {
    const c = contentFromRequest(webRequest({ 'x-forwarded-for': entry }), {
      trustedProxyHops: 1,
    });
    expect(c.userIp).toBe(ip);
  });

  it('quotes a malformed X-Forwarded-For entry as the proxy sent it', () => {
    expect(() =>
      contentFromRequest(webRequest({ 'x-forwarded-for': '[garbage]:80' }), {
        trustedProxyHops: 1,
      })
    ).toThrow('"[garbage]:80"');
  });

  it('rejects a chain shorter than the declared hops', () => {
    expect(() =>
      contentFromRequest(webRequest({}), { remoteAddress: '10.0.0.1', trustedProxyHops: 1 })
    ).toThrow(/too few entries/);
  });

  it('rejects a malformed address at the client position', () => {
    expect(() =>
      contentFromRequest(webRequest({ 'x-forwarded-for': 'unknown' }), {
        remoteAddress: '10.0.0.1',
        trustedProxyHops: 1,
      })
    ).toThrow(ValidationError);
  });

  it('ignores vendor single-IP headers even behind trusted hops', () => {
    const c = contentFromRequest(
      webRequest({ 'x-forwarded-for': '203.0.113.5', 'cf-connecting-ip': '6.6.6.6' }),
      { remoteAddress: '10.0.0.1', trustedProxyHops: 1 }
    );
    expect(c.userIp).toBe('203.0.113.5');
  });

  it('prefers an explicit clientIp over everything else', () => {
    const c = contentFromRequest(webRequest({ 'x-forwarded-for': '9.9.9.9' }), {
      remoteAddress: '10.0.0.1',
      trustedProxyHops: 1,
      clientIp: '198.51.100.7',
    });
    expect(c.userIp).toBe('198.51.100.7');
  });

  it('rejects an invalid explicit clientIp', () => {
    expect(() => contentFromRequest(webRequest({}), { clientIp: '999.1.1.1' })).toThrow(
      ValidationError
    );
  });

  it('rejects a negative or fractional hop count', () => {
    expect(() =>
      contentFromRequest(webRequest({}), { remoteAddress: '10.0.0.1', trustedProxyHops: -1 })
    ).toThrow(ValidationError);
    expect(() =>
      contentFromRequest(webRequest({}), { remoteAddress: '10.0.0.1', trustedProxyHops: 1.5 })
    ).toThrow(ValidationError);
  });

  it('collapses IPv4-mapped peer addresses from dual-stack sockets', () => {
    const c = contentFromRequest(nodeRequest({}, '::ffff:192.0.2.1'));
    expect(c.userIp).toBe('192.0.2.1');
  });
});

describe('header forwarding', () => {
  const sensitive = {
    'user-agent': 'UA',
    referer: 'https://ref.example',
    cookie: 'sessionid=abc',
    authorization: 'Bearer xyz',
    'proxy-authorization': 'Basic abc',
    'x-api-key': 'private-service-secret',
    'x-csrf-token': 'csrf',
    'accept-language': 'en-US',
  };

  it('sends only user agent and referrer by default', () => {
    const c = contentFromRequest(webRequest(sensitive), { remoteAddress: '10.0.0.1' });
    expect(c.userAgent).toBe('UA');
    expect(c.referrer).toBe('https://ref.example');
    expect(c.serverVariables).toEqual({});
    const wire = JSON.stringify(c);
    expect(wire).not.toContain('private-service-secret');
    expect(wire).not.toContain('sessionid');
    expect(wire).not.toContain('Bearer');
  });

  it('forwards only allowlisted headers, under their CGI names', () => {
    const c = contentFromRequest(webRequest(sensitive), {
      remoteAddress: '10.0.0.1',
      forwardHeaders: ['accept-language', 'x-missing'],
    });
    expect(c.serverVariables).toEqual({ HTTP_ACCEPT_LANGUAGE: 'en-US' });
  });

  it('applies the same rules to Node requests', () => {
    const c = contentFromRequest(nodeRequest(sensitive, '10.0.0.1'), {
      forwardHeaders: ['Accept-Language'],
    });
    expect(c.userIp).toBe('10.0.0.1');
    expect(c.serverVariables).toEqual({ HTTP_ACCEPT_LANGUAGE: 'en-US' });
    expect(JSON.stringify(c)).not.toContain('private-service-secret');
  });

  it.each([
    'x-real-ip',
    'X-Forwarded-For',
    'cf-connecting-ip',
    'true-client-ip',
    'akamai-origin-hop',
    'x-varnish',
    'forwarded',
    'x_real_ip',
  ])('refuses to forward IP-override header %s', (name) => {
    const options = { remoteAddress: '127.0.0.1', forwardHeaders: [name] };
    expect(() => contentFromRequest(webRequest({ [name]: '203.0.113.9' }), options)).toThrow(
      ValidationError
    );
    expect(() =>
      contentFromRequest(nodeRequest({ [name.toLowerCase()]: '203.0.113.9' }, '127.0.0.1'), {
        forwardHeaders: [name],
      })
    ).toThrow(ValidationError);
  });

  it('never reads the author role from the request', () => {
    const c = contentFromRequest(webRequest({ 'user-role': 'administrator' }), {
      remoteAddress: '10.0.0.1',
      forwardHeaders: ['user-role'],
    });
    expect(c.userRole).toBeUndefined();
    expect(c.serverVariables).toEqual({ HTTP_USER_ROLE: 'administrator' });
  });
});

describe('Node requests', () => {
  it('reads the peer address from the socket', () => {
    const c = contentFromRequest(
      nodeRequest({ 'user-agent': 'UA', referer: 'https://r' }, '1.2.3.4')
    );
    expect(c.userIp).toBe('1.2.3.4');
    expect(c.userAgent).toBe('UA');
    expect(c.referrer).toBe('https://r');
  });

  it('walks X-Forwarded-For right to left past the declared hops', () => {
    const req = nodeRequest({ 'x-forwarded-for': '203.0.113.66, 198.51.100.7' }, '10.0.0.1');
    expect(contentFromRequest(req, { trustedProxyHops: 1 }).userIp).toBe('198.51.100.7');
  });

  it('lets an explicit remoteAddress override the socket', () => {
    const c = contentFromRequest(nodeRequest({}, '1.2.3.4'), {
      remoteAddress: '5.6.7.8',
    });
    expect(c.userIp).toBe('5.6.7.8');
  });
});

// Next.js Server Actions get headers() and no request: there is no socket to fall back on.
describe('bare Headers', () => {
  it('reads the client from the forwarding chain behind the declared hops', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.5', 'user-agent': 'UA' });
    const c = contentFromRequest(headers, { trustedProxyHops: 1 });
    expect(c.userIp).toBe('203.0.113.5');
    expect(c.userAgent).toBe('UA');
  });

  it('requires hops or an explicit clientIp', () => {
    expect(() => contentFromRequest(new Headers({ 'x-forwarded-for': '9.9.9.9' }))).toThrow(
      ValidationError
    );
    expect(contentFromRequest(new Headers(), { clientIp: '198.51.100.7' }).userIp).toBe(
      '198.51.100.7'
    );
  });
});

describe('Express requests', () => {
  // Express adds req.get(), which a Headers check on the request itself would mistake for Headers.
  it('reads them as Node requests, socket included', () => {
    const req = Object.assign(nodeRequest({ 'user-agent': 'UA' }, '1.2.3.4'), {
      get: (name: string) => (name === 'user-agent' ? 'UA' : undefined),
    });
    const c = contentFromRequest(req);
    expect(c.userIp).toBe('1.2.3.4');
    expect(c.userAgent).toBe('UA');
  });
});

// A second copy of undici, a polyfill, or another realm has its own Headers and FormData;
// constructor identity fails across copies, so the shape is what counts.
class OtherHeaders {
  readonly #map: Map<string, string>;
  constructor(init: Record<string, string>) {
    this.#map = new Map(Object.entries(init));
  }
  get(name: string): string | null {
    return this.#map.get(name.toLowerCase()) ?? null;
  }
}

describe('sources from another Headers or FormData implementation', () => {
  it('reads a Web request whose headers are not the global Headers', () => {
    const request = {
      headers: new OtherHeaders({ 'user-agent': 'UA', 'x-forwarded-for': '203.0.113.5' }),
    } as unknown as Request;
    const c = contentFromRequest(request, { trustedProxyHops: 1 });
    expect(c.userIp).toBe('203.0.113.5');
    expect(c.userAgent).toBe('UA');
  });

  it('reads the honeypot from a form that is not the global FormData', () => {
    const form = new OtherHeaders({ akismet_honeypot_name: 'hp', hp: 'filled' });
    const c = contentFromRequest(new Headers(), {
      clientIp: '192.0.2.1',
      form: form as unknown as FormData,
    });
    expect(c.honeypotFieldName).toBe('hp');
    expect(c.honeypotFieldValue).toBe('filled');
  });

  // Node lowercases header names into a plain object, so a client can send one called `get`.
  it('still reads a Node request whose client sent a header named get', () => {
    const c = contentFromRequest(nodeRequest({ get: 'x', 'user-agent': 'UA' }, '1.2.3.4'));
    expect(c.userIp).toBe('1.2.3.4');
    expect(c.userAgent).toBe('UA');
  });

  it('rejects a source that is neither a request nor headers', () => {
    expect(() => contentFromRequest({} as unknown as Headers, { clientIp: '192.0.2.1' })).toThrow(
      ValidationError
    );
  });
});

describe('akismet.forRequest', () => {
  it('checks the given content merged over the request', async () => {
    const { client, fetchMock } = clientWith('false');
    const bound = client.forRequest(
      webRequest({ 'user-agent': 'UA', 'x-forwarded-for': '203.0.113.5' }),
      { trustedProxyHops: 1, form: { akismet_honeypot_name: 'hp', hp: '' } }
    );
    await bound.check({ body: 'hello' });
    const sent = sentBody(fetchMock);
    expect(sent.get('user_ip')).toBe('203.0.113.5');
    expect(sent.get('user_agent')).toBe('UA');
    expect(sent.get('comment_content')).toBe('hello');
    expect(sent.get('honeypot_field_name')).toBe('hp');
  });

  it('ignores fields given as undefined', async () => {
    const { client, fetchMock } = clientWith('false');
    const bound = client.forRequest(webRequest({ 'user-agent': 'UA' }), {
      clientIp: '192.0.2.1',
      form: { akismet_honeypot_name: 'hp', hp: '' },
    });
    await bound.check({ body: 'hello', userAgent: undefined, honeypotFieldName: undefined });
    const sent = sentBody(fetchMock);
    expect(sent.get('user_agent')).toBe('UA');
    expect(sent.get('honeypot_field_name')).toBe('hp');
  });

  // A middleware binds every request; a misconfigured hop count must only fail routes that check.
  it('reads the request only when check runs', async () => {
    const { client, fetchMock } = clientWith('false');
    const bound = client.forRequest(webRequest({}), { trustedProxyHops: 1 });
    await expect(bound.check({ body: 'x' })).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers no feedback methods', () => {
    const bound = clientOver(vi.fn()).forRequest(new Headers(), { clientIp: '192.0.2.1' });
    expect(Object.keys(bound).toSorted()).toEqual(['check', 'content']);
  });

  // Feedback replays the content exactly as checked, so callers store what content() returns.
  it('returns the content it checks', async () => {
    const { client, fetchMock } = clientWith(FEEDBACK_SUCCESS_BODY);
    fetchMock.mockResolvedValueOnce(new Response('false'));
    const bound = client.forRequest(new Headers({ 'user-agent': 'UA' }), {
      clientIp: '192.0.2.1',
    });
    const content = bound.content({ body: 'hello' });
    expect(content).toMatchObject({ userIp: '192.0.2.1', userAgent: 'UA', body: 'hello' });
    await bound.check(content);
    // eslint-disable-next-line unicorn/prefer-structured-clone -- the JSON round trip is the point
    await client.submitSpam(JSON.parse(JSON.stringify(content)) as Content);
    const check = sentBody(fetchMock, 0);
    const feedback = sentBody(fetchMock, 1);
    expect(feedback.get('user_agent')).toBe(check.get('user_agent'));
    expect(feedback.get('comment_content')).toBe('hello');
  });
});
