import { describe, expect, it, vi } from 'vitest';
import {
  Akismet,
  InvalidApiKeyError,
  NetworkError,
  SDK_VERSION,
  ServerError,
  SpamVerdict,
  ValidationError,
} from '../src/index.js';
import {
  clientOver,
  clientWith,
  FEEDBACK_SUCCESS_BODY,
  sentBody,
  STATS_BODY,
  TEST_API_KEY,
  USAGE_BODY,
} from './wire.js';

const SITES_BODY = JSON.stringify({ '2026-04': [], limit: 500, offset: 0, total: 0 });

type Call = (client: Akismet) => Promise<unknown>;

/** Every endpoint: a body it accepts, its path, and a call that reaches it. */
const ENDPOINTS = {
  verifyKey: { body: 'valid', path: '/1.1/verify-key', call: (c) => c.verifyKey() },
  check: {
    body: 'false',
    path: '/1.1/comment-check',
    call: (c) => c.check({ userIp: '192.0.2.1' }),
  },
  submitSpam: {
    body: FEEDBACK_SUCCESS_BODY,
    path: '/1.1/submit-spam',
    call: (c) => c.submitSpam({ userIp: '192.0.2.1' }),
  },
  submitHam: {
    body: FEEDBACK_SUCCESS_BODY,
    path: '/1.1/submit-ham',
    call: (c) => c.submitHam({ userIp: '192.0.2.1' }),
  },
  getUsageLimit: { body: USAGE_BODY, path: '/1.2/usage-limit', call: (c) => c.getUsageLimit() },
  getSubscription: { body: '{}', path: '/1.1/get-subscription', call: (c) => c.getSubscription() },
  getStats: { body: STATS_BODY, path: '/1.2/get-key-stats', call: (c) => c.getStats() },
  getKeySites: { body: SITES_BODY, path: '/1.2/key-sites', call: (c) => c.getKeySites() },
  revokeSite: { body: 'Revoked', path: '/1.2/revoke-site', call: (c) => c.revokeSite('abc123') },
  unrevokeSite: {
    body: 'Unrevoked',
    path: '/1.2/unrevoke-site',
    call: (c) => c.unrevokeSite('abc123'),
  },
  deactivate: { body: 'deactivated', path: '/1.1/deactivate', call: (c) => c.deactivate() },
  getAccessToken: { body: 'token', path: '/1.1/token', call: (c) => c.getAccessToken() },
} satisfies Record<string, { body: string; path: string; call: Call }>;

type Endpoint = keyof typeof ENDPOINTS;

describe('endpoints', () => {
  it.each(Object.keys(ENDPOINTS) as Endpoint[])(
    '%s POSTs to its path with no query string',
    async (name) => {
      const { body, path, call } = ENDPOINTS[name];
      const { client, fetchMock } = clientWith(body);
      await call(client);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://rest.akismet.com${path}`);
      expect(init.method).toBe('POST');
    }
  );

  // A blog field makes the server reject a revoked site and register the site on the key.
  it.each(['revokeSite', 'unrevokeSite', 'getStats', 'getUsageLimit', 'getKeySites'] as const)(
    '%s sends api_key and no blog',
    async (name) => {
      const { body, call } = ENDPOINTS[name];
      const { client, fetchMock } = clientWith(body);
      await call(client);
      const sent = sentBody(fetchMock);
      expect(sent.get('api_key')).toBe(TEST_API_KEY);
      expect(sent.has('blog')).toBe(false);
    }
  );

  it.each(['revokeSite', 'unrevokeSite'] as const)('%s sends the site hash', async (name) => {
    const { body, call } = ENDPOINTS[name];
    const { client, fetchMock } = clientWith(body);
    await call(client);
    expect(sentBody(fetchMock).get('hash')).toBe('abc123');
  });

  // The server reads the hash with PHP empty(), which treats "0" as missing.
  it.each(['revokeSite', 'unrevokeSite'] as const)(
    '%s rejects an empty or "0" hash before sending',
    async (method) => {
      const fetchMock = vi.fn();
      const client = clientOver(fetchMock);
      for (const hash of ['', '  ', '0']) {
        await expect(client[method](hash)).rejects.toBeInstanceOf(ValidationError);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each(['submitSpam', 'submitHam'] as const)(
    '%s rejects any body other than the thank-you message',
    async (method) => {
      const { client } = clientWith('false');
      await expect(client[method]({ userIp: '127.0.0.1', body: 'x' })).rejects.toBeInstanceOf(
        ServerError
      );
    }
  );

  it('getStats throws ServerError on non-object JSON body', async () => {
    await expect(clientWith('[1, 2, 3]').client.getStats()).rejects.toBeInstanceOf(ServerError);
  });

  it.each([
    ['getUsageLimit', (c: Akismet) => c.getUsageLimit()],
    ['getKeySites', (c: Akismet) => c.getKeySites()],
  ])('%s maps an invalid body to InvalidApiKeyError, not a parse failure', async (_name, call) => {
    await expect(call(clientWith('invalid').client)).rejects.toBeInstanceOf(InvalidApiKeyError);
  });
});

describe('transport', () => {
  it.each([
    ['verifyKey', 'valid', (c: Akismet) => c.verifyKey()],
    ['getAccessToken', 'token', (c: Akismet) => c.getAccessToken()],
  ])('retries network errors when retries > 0: %s', async (_name, body, call) => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('connect ECONNRESET'))
        .mockResolvedValueOnce(new Response(body));

      const pending = call(clientOver(fetchMock, { retries: 1 }));
      await vi.advanceTimersByTimeAsync(500);
      await pending;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry when the body read fails after headers were received', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const body = new ReadableStream({
        start(controller) {
          controller.error(new Error('ECONNRESET mid-body'));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });

    await expect(clientOver(fetchMock, { retries: 3 }).verifyKey()).rejects.toBeInstanceOf(
      NetworkError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // A transport error after the server acted would replay the side effect.
  it.each([
    ['submitSpam', (c: Akismet) => c.submitSpam({ userIp: '127.0.0.1', body: 'x' })],
    ['submitHam', (c: Akismet) => c.submitHam({ userIp: '127.0.0.1', body: 'x' })],
    ['revokeSite', (c: Akismet) => c.revokeSite('hash1')],
    ['unrevokeSite', (c: Akismet) => c.unrevokeSite('hash1')],
    ['deactivate', (c: Akismet) => c.deactivate()],
  ])('never retries a side-effecting call: %s', async (_name, call) => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connect ECONNRESET'));

    await expect(call(clientOver(fetchMock, { retries: 3 }))).rejects.toThrow(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('applies the per-request timeout to a stalled response body', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      // Headers arrive at once, but the body never completes unless the signal fires.
      const body = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () => {
            controller.error(new Error('aborted'));
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });

    await expect(clientOver(fetchMock, { timeoutMs: 20 }).verifyKey()).rejects.toBeInstanceOf(
      NetworkError
    );
  });
});

describe('getKeySites', () => {
  it('takes an options object and sends its params', async () => {
    const { client, fetchMock } = clientWith(SITES_BODY);
    await client.getKeySites({
      month: '2026-04',
      filter: 'example',
      limit: 100,
      offset: 50,
      order: 'spam',
      extended: true,
    });
    const sent = sentBody(fetchMock);
    expect(sent.get('month')).toBe('2026-04');
    expect(sent.get('filter')).toBe('example');
    expect(sent.get('limit')).toBe('100');
    expect(sent.get('offset')).toBe('50');
    expect(sent.get('order')).toBe('spam');
    expect(sent.get('extended')).toBe('true');
  });

  // JS callers pass a missing query parameter as null, the way URLSearchParams.get() returns it.
  it('leaves out null and empty filters', async () => {
    const { client, fetchMock } = clientWith(SITES_BODY);
    await client.getKeySites({ month: null, filter: '', order: null } as never);
    const sent = sentBody(fetchMock);
    expect(['month', 'filter', 'order'].filter((key) => sent.has(key))).toEqual([]);
  });

  it.each([
    { month: '2026-13' },
    { month: '2026-4' },
    { limit: 0 },
    { limit: 1.5 },
    { limit: 2 ** 53 },
    { offset: -1 },
    { offset: 1.5 },
    { offset: 2 ** 53 },
  ])('rejects %o before sending', async (options) => {
    const fetchMock = vi.fn();
    await expect(clientOver(fetchMock).getKeySites(options)).rejects.toThrow(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('feedback options', () => {
  it('submitSpam attaches the previous verdict and reporter from options, not from the content', async () => {
    const previous = await clientWith('false').client.check({ userIp: '203.0.113.5' });
    const { client, fetchMock } = clientWith(FEEDBACK_SUCCESS_BODY);

    await client.submitSpam(
      { userIp: '203.0.113.5', body: 'x' },
      { previousVerdict: previous, reporter: 'moderator@example.com' }
    );

    const body = sentBody(fetchMock);
    expect(body.get('comment_check_response')).toBe('false');
    expect(body.get('reporter')).toBe('moderator@example.com');
    expect(body.get('user_ip')).toBe('203.0.113.5');
  });

  // A stored `discard` verdict is spam Akismet was sure of.
  it('submitHam accepts a stored verdict string as the previous verdict', async () => {
    const { client, fetchMock } = clientWith(FEEDBACK_SUCCESS_BODY);
    await client.submitHam({ userIp: '203.0.113.5' }, { previousVerdict: SpamVerdict.Discard });

    const body = sentBody(fetchMock);
    expect(body.get('comment_check_response')).toBe('true');
    expect(body.has('reporter')).toBe(false);
  });

  it('rejects a stored previous verdict that is not a verdict', async () => {
    const fetchMock = vi.fn();
    await expect(
      clientOver(fetchMock).submitSpam(
        { userIp: '203.0.113.5' },
        { previousVerdict: 'true' as SpamVerdict }
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('new Akismet', () => {
  it.each([
    [{ apiKey: '  ' }, 'blank key'],
    [{ apiKey: 12_345 }, 'numeric key'],
    [{ site: 'not a url' }, 'site not a URL'],
    [{ timeoutMs: 0 }, 'zero timeout'],
    [{ timeoutMs: Number.NaN }, 'NaN timeout'],
    [{ timeoutMs: -1 }, 'negative timeout'],
    [{ retries: -1 }, 'negative retries'],
    [{ retries: 1.5 }, 'fractional retries'],
    // fetch would refuse the header on every call, surfacing as a retryable NetworkError.
    [{ applicationUserAgent: 'MyApp\r\nX-Injected: 1' }, 'line break in user agent'],
  ])('rejects %o (%s)', (overrides, _label) => {
    expect(() => clientOver(vi.fn(), overrides as never)).toThrow(ValidationError);
  });
});

describe('User-Agent', () => {
  // The server attributes traffic by User-Agent prefix; the PHP SDK owns `Automattic-Akismet-SDK/`.
  it('identifies the JavaScript SDK, after any application token', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('valid')));
    await clientOver(fetchMock).verifyKey();
    await clientOver(fetchMock, { applicationUserAgent: 'MyIntegration/1.0.0' }).verifyKey();

    const agents = fetchMock.mock.calls.map(([, init]) =>
      new Headers((init as RequestInit).headers).get('User-Agent')
    );
    expect(agents).toEqual([
      `Automattic-Akismet-SDK-JS/${SDK_VERSION}`,
      `MyIntegration/1.0.0 | Automattic-Akismet-SDK-JS/${SDK_VERSION}`,
    ]);
  });
});
