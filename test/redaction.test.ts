import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  type Akismet,
  AkismetError,
  ClientError,
  InvalidApiKeyError,
  NetworkError,
  ServerError,
  type ThrottledError,
} from '../src/index.js';
import { clientOver } from './wire.js';

const KEY = 'sekret12345';
const ENCODED_KEY = encodeURIComponent('sek ret');

function client(fetchImpl: typeof fetch, apiKey = KEY): Akismet {
  return clientOver(fetchImpl, { apiKey, timeoutMs: 50 });
}

function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain', ...headers } });
}

/** Everything a logger could print: inspect output, own properties, and the whole cause chain. */
function everythingVisible(error: unknown): string {
  const parts: string[] = [inspect(error, { depth: 10 })];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(
      JSON.stringify(current, Object.getOwnPropertyNames(current)),
      current.stack ?? '',
      current.message
    );
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join('\n');
}

async function capture(run: () => Promise<unknown>): Promise<AkismetError> {
  try {
    await run();
  } catch (e) {
    if (e instanceof AkismetError) {
      return e;
    }
    throw e;
  }
  throw new Error('expected the call to throw');
}

describe('errors never expose the API key', () => {
  it('redacts the key from a pre-response fetch failure and its cause chain', async () => {
    const fetchImpl: typeof fetch = () => {
      const inner = new Error(`connect ECONNREFUSED ...?api_key=${KEY}`);
      (inner as { code?: string }).code = 'ECONNREFUSED';
      throw new TypeError(
        `fetch failed for https://rest.akismet.com/1.2/usage-limit?api_key=${KEY}`,
        {
          cause: inner,
        }
      );
    };
    const e = await capture(() => client(fetchImpl).getUsageLimit());
    expect(e).toBeInstanceOf(NetworkError);
    expect(everythingVisible(e)).not.toContain(KEY);
    const cause = (e as { cause?: Error }).cause;
    expect(cause?.name).toBe('TypeError');
    expect((cause as { cause?: { code?: string } }).cause?.code).toBe('ECONNREFUSED');
  });

  it('redacts the key from a mid-stream failure', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve({
        status: 200,
        headers: new Headers(),
        text: () => Promise.reject(new Error(`stream reset while reading ?api_key=${KEY}`)),
      } as unknown as Response);
    const e = await capture(() => client(fetchImpl).verifyKey());
    expect(e).toBeInstanceOf(NetworkError);
    expect(everythingVisible(e)).not.toContain(KEY);
  });

  it('redacts the key from a timeout cause', async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error(`aborted https://rest.akismet.com/1.1/verify-key key=${KEY}`));
        });
      });
    const e = await capture(() => client(fetchImpl).verifyKey());
    expect(e).toBeInstanceOf(NetworkError);
    expect(everythingVisible(e)).not.toContain(KEY);
  });

  it('redacts the key from 5xx and 4xx bodies that echo the request URL', async () => {
    const page = `<h1>502</h1><p>upstream https://rest.akismet.com/1.2/key-sites?limit=1&api_key=${KEY}</p>`;
    const server = await capture(() =>
      client(() => Promise.resolve(textResponse(page, 502))).getKeySites()
    );
    expect(server).toBeInstanceOf(ServerError);
    expect(everythingVisible(server)).not.toContain(KEY);

    const clientErr = await capture(() =>
      client(() => Promise.resolve(textResponse(page, 404))).getKeySites()
    );
    expect(clientErr).toBeInstanceOf(ClientError);
    expect(everythingVisible(clientErr)).not.toContain(KEY);
  });

  it('redacts the key from the debug-help header on an invalid response', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        textResponse('invalid', 200, {
          'x-akismet-debug-help': `We were unable to parse key ${KEY}`,
        })
      );
    const e = await capture(() => client(fetchImpl).verifyKey());
    expect(e).toBeInstanceOf(InvalidApiKeyError);
    expect(everythingVisible(e)).not.toContain(KEY);
    expect(e.message).toContain('unable to parse key');
  });

  it('redacts the key from an unexpected response body', async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(textResponse(`echo ${KEY} back`));
    const e = await capture(() => client(fetchImpl).check({ userIp: '192.0.2.1' }));
    expect(e).toBeInstanceOf(ServerError);
    expect(everythingVisible(e)).not.toContain(KEY);
  });

  it('redacts the URL-encoded form of a key with reserved characters', async () => {
    const fetchImpl: typeof fetch = () => {
      throw new Error(`fetch failed ?api_key=${ENCODED_KEY}&blog=x`);
    };
    const e = await capture(() => client(fetchImpl, 'sek ret').getUsageLimit());
    expect(everythingVisible(e)).not.toContain(ENCODED_KEY);
    expect(everythingVisible(e)).not.toContain('sek ret');
  });

  it('leaves successful response bodies untouched, even when they contain the key', async () => {
    const token = `token-for-${KEY}`;
    const fetchImpl: typeof fetch = () => Promise.resolve(textResponse(token));
    await expect(client(fetchImpl).getAccessToken()).resolves.toBe(token);
  });

  it('rethrows the caller abort reason even when the fetch implementation wraps cancellation', async () => {
    const controller = new AbortController();
    const reason = new Error('caller abort');
    const fetchImpl: typeof fetch = (url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
          reject(new Error(`request to ${target} was cancelled`));
        });
      });
    const akismet = clientOver(fetchImpl, { apiKey: KEY, signal: controller.signal });
    const pending = akismet.getUsageLimit();
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('redacts the key from cause name and code, not just message and stack', async () => {
    const fetchImpl: typeof fetch = () => {
      const inner = new Error('refused');
      inner.name = `Error[${KEY}]`;
      (inner as { code?: string }).code = `ECONNREFUSED ?api_key=${KEY}`;
      throw new TypeError('fetch failed', { cause: inner });
    };
    const e = await capture(() => client(fetchImpl).getUsageLimit());
    expect(e).toBeInstanceOf(NetworkError);
    expect(everythingVisible(e)).not.toContain(KEY);
    const inner = (e as { cause?: { cause?: { name: string; code?: string } } }).cause?.cause;
    expect(inner?.name).toBe('Error[***]');
    expect(inner?.code).toBe('ECONNREFUSED ?api_key=***');
  });

  it('survives a self-referencing cause and keeps the error retryable', async () => {
    const fetchImpl: typeof fetch = () => {
      const loop = new Error(`loop ?api_key=${KEY}`);
      (loop as { cause?: unknown }).cause = loop;
      throw loop;
    };
    const e = await capture(() => client(fetchImpl).getUsageLimit());
    expect(e).toBeInstanceOf(NetworkError);
    expect((e as NetworkError).retryable).toBe(true);
    const visible = everythingVisible(e);
    expect(visible).not.toContain(KEY);
    expect(visible).toContain('circular cause omitted');
  });

  it('survives a two-node cause cycle', async () => {
    const fetchImpl: typeof fetch = () => {
      const a = new Error('a');
      const b = new Error('b', { cause: a });
      (a as { cause?: unknown }).cause = b;
      throw a;
    };
    const e = await capture(() => client(fetchImpl).getUsageLimit());
    expect(e).toBeInstanceOf(NetworkError);
    expect(everythingVisible(e)).toContain('circular cause omitted');
  });

  it('truncates a very deep cause chain', async () => {
    const fetchImpl: typeof fetch = () => {
      let error = new Error('bottom');
      for (let i = 0; i < 50; i++) {
        error = new Error(`level ${String(i)}`, { cause: error });
      }
      throw error;
    };
    const e = await capture(() => client(fetchImpl).getUsageLimit());
    expect(e).toBeInstanceOf(NetworkError);
    const visible = everythingVisible(e);
    expect(visible).toContain('cause chain truncated');
    expect(visible).not.toContain('bottom');
  });

  it('leaves no prefix of the key when a long error body is truncated', async () => {
    const page = `${'<p>'.repeat(65)}${KEY}</p>`;
    const e = await capture(() => client(() => Promise.resolve(textResponse(page))).verifyKey());
    expect(e).toBeInstanceOf(ServerError);
    expect(e.message).toContain('...');
    expect(everythingVisible(e)).not.toContain(KEY.slice(0, 4));
  });

  it('redacts the per-call key from response bodies and headers', async () => {
    const tenantKey = 'tenantkeyzzz';
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        textResponse(`unexpected ${tenantKey}`, 200, { 'x-akismet-debug-help': `key ${tenantKey}` })
      );
    const e = await capture(() => client(fetchImpl).verifyKey({ apiKey: tenantKey }));
    expect(e).toBeInstanceOf(ServerError);
    const error = e as ServerError;
    expect(error.message).not.toContain(tenantKey);
    expect(error.debugHelp).not.toContain(tenantKey);
    expect(JSON.stringify(error.headers)).not.toContain(tenantKey);
  });

  it('redacts the lowercased, punctuation-free form the server echoes in alerts', async () => {
    // The server normalizes the key before it quotes it in a revocation alert.
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        textResponse('invalid', 200, {
          'x-akismet-alert-code': '10403',
          'x-akismet-alert-msg': 'Key mixedkey0042 has been revoked for this site',
          'x-akismet-debug-help': 'MIXEDKEY0042',
        })
      );
    const e = await capture(() => client(fetchImpl, 'MiXeD-KeY-0042').verifyKey());
    expect(everythingVisible(e).toLowerCase()).not.toContain('mixedkey0042');
  });

  it('redacts the key from headers attached to a response error', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        textResponse('invalid', 200, {
          'x-akismet-alert-code': '10508',
          'x-akismet-alert-msg': `Over limit for key ${KEY}`,
          'x-akismet-alert-upgrade-url': `https://akismet.com/account/?k=${KEY}`,
        })
      );
    const e = await capture(() => client(fetchImpl).check({ userIp: '192.0.2.1' }));
    expect(everythingVisible(e)).not.toContain(KEY);
    expect((e as ThrottledError).alert?.message).toContain('Over limit');
  });
});

describe('error bodies', () => {
  it.each([502, 404])('truncates a long %i error page after redacting it', async (status) => {
    const page = `${'<p>x</p>'.repeat(500)}${KEY}`;
    const e = await capture(() =>
      client(() => Promise.resolve(textResponse(page, status))).getUsageLimit()
    );
    expect(e.message.length).toBeLessThan(400);
    expect(everythingVisible(e)).not.toContain(KEY.slice(0, 4));
  });
});

describe('the client never exposes the API key', () => {
  it('keeps the key out of an inspected or serialized client', () => {
    const akismet = client(() => Promise.reject(new Error('unused')));
    expect(inspect(akismet, { depth: 10, showHidden: true })).not.toContain(KEY);
    expect(JSON.stringify(akismet)).not.toContain(KEY);
  });
});
