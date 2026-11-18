import { describe, expect, it, vi } from 'vitest';
import { NetworkError, ValidationError } from '../src/index.js';
import {
  clientOver,
  clientWith,
  FEEDBACK_SUCCESS_BODY,
  sentBody,
  STATS_BODY,
  TEST_API_KEY,
  TEST_SITE,
  USAGE_BODY,
} from './wire.js';

const content = { userIp: '192.0.2.1', body: 'hello' };

describe('per-call request options', () => {
  it('overrides the API key and site for one call only', async () => {
    const { client, fetchMock } = clientWith('false');
    await client.check(content, { apiKey: 'b'.repeat(12), site: 'https://tenant.example/' });
    await client.check(content);

    const first = sentBody(fetchMock, 0);
    expect(first.get('api_key')).toBe('b'.repeat(12));
    expect(first.get('blog')).toBe('https://tenant.example');
    const second = sentBody(fetchMock, 1);
    expect(second.get('api_key')).toBe(TEST_API_KEY);
    expect(second.get('blog')).toBe(TEST_SITE);
  });

  it('uses the per-call key on the usage-limit lookup too', async () => {
    const { client, fetchMock } = clientWith(USAGE_BODY);
    await client.getUsageLimit({ apiKey: 'c'.repeat(12) });
    expect(sentBody(fetchMock).get('api_key')).toBe('c'.repeat(12));
  });

  it('turns test mode on or off per call', async () => {
    const { client, fetchMock } = clientWith('false');
    await client.check(content, { isTest: true });
    await client.check(content);
    expect(sentBody(fetchMock, 0).get('is_test')).toBe('1');
    expect(sentBody(fetchMock, 1).has('is_test')).toBe(false);

    const testClient = clientOver(fetchMock, { isTest: true });
    await testClient.check(content, { isTest: false });
    expect(sentBody(fetchMock, 2).has('is_test')).toBe(false);
  });

  it('rejects an empty key or an invalid site override before sending', async () => {
    const { client, fetchMock } = clientWith('false');
    await expect(client.check(content, { apiKey: '  ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(client.check(content, { site: 'not a url' })).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(client.check(content, { timeoutMs: 0 })).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Without exactOptionalPropertyTypes, `{ apiKey: tenant.key }` type-checks when the key is missing.
  it.each([undefined, null])(
    'rejects a key or site given as %s instead of falling back to the client',
    async (value) => {
      const { client, fetchMock } = clientWith('false');
      const missing = value as unknown as string;
      await expect(client.check(content, { apiKey: missing })).rejects.toThrow(/omit it/);
      await expect(client.check(content, { site: missing })).rejects.toThrow(/omit it/);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('rejects options that are not an object', async () => {
    const { client, fetchMock } = clientWith('valid');
    await expect(client.verifyKey('a-key' as never)).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies a per-call timeout', async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const client = clientOver(fetchImpl, { timeoutMs: 60_000 });
    const e = await client.check(content, { timeoutMs: 20 }).catch((error: unknown) => error);
    expect(e).toBeInstanceOf(NetworkError);
    expect((e as NetworkError).retryable).toBe(false);
  });

  it('honours a per-call abort signal and rethrows its reason', async () => {
    const controller = new AbortController();
    const reason = new Error('user navigated away');
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('wrapped by fetch'));
        });
      });
    const client = clientOver(fetchImpl);
    const pending = client.check(content, { signal: controller.signal });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  // An already-aborted signal never fires its abort event, so it must be read up front.
  it('rethrows the reason of a signal that was aborted before the call', async () => {
    const reason = new Error('already gone');
    // Answers unless the signal is aborted when fetch is called, so only the up-front read
    // can turn this call into a rejection; the timeout never gets the chance.
    const fetchImpl: typeof fetch = (_url, init) =>
      init?.signal?.aborted === true
        ? Promise.reject(new Error('wrapped by fetch'))
        : Promise.resolve(new Response('false'));
    const client = clientOver(fetchImpl);
    await expect(client.check(content, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  });

  it('merges the client-wide signal with the per-call signal', async () => {
    const clientController = new AbortController();
    const callController = new AbortController();
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      });
    const client = clientOver(fetchImpl, { signal: clientController.signal });
    const reason = new Error('shutdown');
    const pending = client.check(content, { signal: callController.signal });
    clientController.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('redacts the per-call key, not only the client key, from errors', async () => {
    const perCallKey = 'd'.repeat(12);
    const fetchImpl: typeof fetch = () => {
      throw new Error(`fetch failed ?api_key=${perCallKey}`);
    };
    const client = clientOver(fetchImpl);
    const e = await client.getUsageLimit({ apiKey: perCallKey }).catch((error: unknown) => error);
    expect(e).toBeInstanceOf(NetworkError);
    expect(JSON.stringify(e, Object.getOwnPropertyNames(e as object))).not.toContain(perCallKey);
  });

  it('getStats takes the interval in its options object', async () => {
    const { client, fetchMock } = clientWith(STATS_BODY);
    await client.getStats({ interval: 'year' });
    expect(sentBody(fetchMock).get('from')).toBe('year');
    expect(sentBody(fetchMock).get('key')).toBe(TEST_API_KEY);
  });
});

// A key read from a config file can arrive as a number; it must fail as ValidationError.
it('rejects a non-string API key before sending anything', async () => {
  const { client, fetchMock } = clientWith('valid');
  await expect(client.verifyKey({ apiKey: 12_345 as unknown as string })).rejects.toBeInstanceOf(
    ValidationError
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

describe('timeouts and retries', () => {
  // A timeout read from an env var without Number() must fail before feedback is sent.
  it('rejects a non-numeric timeout before sending anything', async () => {
    const { client, fetchMock } = clientWith(FEEDBACK_SUCCESS_BODY);
    await expect(
      client.submitSpam({ userIp: '203.0.113.5' }, { timeoutMs: '5' as unknown as number })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // setTimeout fires after 1 ms for anything above 2^31 - 1 ms, so an unclamped Infinity
  // would abort every request at once.
  it('treats a timeout setTimeout cannot represent as no practical limit', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => {
              resolve(new Response('valid'));
            }, 1000);
          })
      );
      const client = clientOver(fetchMock, { timeoutMs: Infinity });
      const pending = client.verifyKey({ timeoutMs: 2 ** 31 });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops waiting between retries when the caller aborts', async () => {
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connect ECONNRESET'));
    // The first attempt fails as retryable; the abort lands during the backoff.
    setTimeout(() => {
      controller.abort(reason);
    }, 20);
    const client = clientOver(fetchMock, { retries: 1 });

    await expect(client.verifyKey({ signal: controller.signal })).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
