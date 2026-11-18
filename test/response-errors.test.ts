import { describe, expect, it, vi } from 'vitest';
import {
  type Akismet,
  ClientError,
  InvalidApiKeyError,
  RequestRejectedError,
  ServerError,
  SuspendedKeyError,
  ThrottledError,
} from '../src/index.js';
import { clientOver, clientWith, sentBody, TEST_API_KEY, TEST_SITE } from './wire.js';

// Each body and header set below is what the API actually sends (checked against the server
// in October 2026). Application errors arrive with HTTP 200; only proxies and a wrong method
// produce another status.
function respond(body: string, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(body, { status, headers });
}

function client(response: Response): Akismet {
  return clientOver(vi.fn().mockResolvedValue(response));
}

const content = { userIp: '192.0.2.1', body: 'hello' };

describe('errors from a 200 body and X-akismet headers', () => {
  it('invalid with no alert → InvalidApiKeyError carrying debug help', async () => {
    const e = await client(respond('invalid', { 'X-akismet-debug-help': 'Empty "api_key" value' }))
      .verifyKey()
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(InvalidApiKeyError);
    const err = e as InvalidApiKeyError;
    expect(err.message).toContain('Empty "api_key" value');
    expect(err.debugHelp).toBe('Empty "api_key" value');
    expect(err.status).toBe(200);
    expect(err.alert).toBeNull();
  });

  it('invalid with alert 10508 → ThrottledError with upgrade metadata', async () => {
    const e = await client(
      respond('invalid', {
        'X-akismet-alert-code': '10508',
        'X-akismet-alert-msg':
          "Your Akismet usage has been over your plan's limit for three consecutive months.",
        'X-akismet-alert-upgrade-type': 'qty',
        'X-akismet-alert-upgrade-url': 'https://akismet.com/account/',
      })
    )
      .check(content)
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(ThrottledError);
    const err = e as ThrottledError;
    expect(err.alert?.code).toBe(10_508);
    expect(err.message).toContain('three consecutive months');
    expect(err.alert?.upgrade).toMatchObject({ url: 'https://akismet.com/account/', type: 'qty' });
  });

  // verify-key and get-key-stats answer a suspended subscription with invalid, the 10009
  // alert, and a support debug-help; there is no X-akismet-error header on these endpoints.
  const suspended = {
    'X-akismet-alert-code': '10009',
    'X-akismet-alert-msg':
      'Your Akismet subscription has been suspended and you are no longer protected from spam. Please click on the link below for further details.',
    'X-akismet-debug-help': 'Please contact akismet.com support staff at akismet.com/contact/',
  };

  it.each([
    ['verifyKey', (c: Akismet) => c.verifyKey()],
    ['getStats', (c: Akismet) => c.getStats()],
  ])('%s: invalid with alert 10009 → SuspendedKeyError', async (_name, call) => {
    const e = await call(client(respond('invalid', suspended))).catch((error: unknown) => error);
    expect(e).toBeInstanceOf(SuspendedKeyError);
    expect((e as SuspendedKeyError).alert?.code).toBe(10_009);
    expect((e as Error).message).toContain('suspended');
  });

  it('invalid with alert 10403 → RequestRejectedError (site not authorized)', async () => {
    const e = await client(
      respond('invalid', {
        'X-akismet-alert-code': '10403',
        'X-akismet-alert-msg': 'This site is not authorized to use the Akismet API key.',
      })
    )
      .check(content)
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(RequestRejectedError);
    expect((e as RequestRejectedError).alert?.code).toBe(10_403);
    expect((e as Error).message).toContain('not authorized');
  });

  it('comment-check false + X-akismet-error suspended → SuspendedKeyError, not ham', async () => {
    const e = await client(
      respond('false', {
        'X-akismet-error': 'suspended',
        'X-akismet-alert-code': '10402',
        'X-akismet-alert-msg': 'Your Akismet API key has been suspended.',
      })
    )
      .check(content)
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(SuspendedKeyError);
    expect((e as SuspendedKeyError).alert?.code).toBe(10_402);
    expect((e as SuspendedKeyError).headers['x-akismet-error']).toBe('suspended');
  });

  it('submit-spam "Invalid key" → SuspendedKeyError', async () => {
    const e = await client(respond('Invalid key'))
      .submitSpam(content)
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(SuspendedKeyError);
  });

  it.each(['Missing required field: blog.', 'Invalid required field: blog. Must be a full URL.'])(
    '"%s" → RequestRejectedError quoting the server',
    async (body) => {
      const e = await client(respond(body, { 'X-akismet-debug-help': 'Empty "blog" value' }))
        .check(content)
        .catch((error: unknown) => error);
      expect(e).toBeInstanceOf(RequestRejectedError);
      expect((e as Error).message).toContain(body);
      expect((e as RequestRejectedError).debugHelp).toBe('Empty "blog" value');
    }
  );

  it('empty alert code means cleared, not zero', async () => {
    const e = await client(respond('invalid', { 'X-akismet-alert-code': '' }))
      .verifyKey()
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(InvalidApiKeyError);
    expect((e as InvalidApiKeyError).alert).toBeNull();
  });

  it('405 "POST request required." → ClientError with status', async () => {
    const e = await client(respond('POST request required.', { Allow: 'POST' }, 405))
      .verifyKey()
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(ClientError);
    expect((e as ClientError).message).toContain('POST request required.');
    expect((e as ClientError).status).toBe(405);
    expect((e as ClientError).headers.allow).toBe('POST');
  });

  it('500 HTML → ServerError with status and headers', async () => {
    const e = await client(respond('<h1>Fatal</h1>', { 'content-type': 'text/html' }, 500))
      .verifyKey()
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(ServerError);
    expect((e as ServerError).message).toContain('<h1>Fatal</h1>');
    expect((e as ServerError).status).toBe(500);
    expect((e as ServerError).headers['content-type']).toBe('text/html');
  });

  it('unexpected 200 body → ServerError that still carries the response', async () => {
    const e = await client(respond('maybe', { 'X-akismet-guid': 'abc' }))
      .verifyKey()
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(ServerError);
    expect((e as ServerError).status).toBe(200);
    expect((e as ServerError).headers['x-akismet-guid']).toBe('abc');
  });
});

describe('fixed-word endpoints', () => {
  it('deactivate accepts "deactivated" and an empty body, rejects the rest', async () => {
    await expect(client(respond('deactivated')).deactivate()).resolves.toBeUndefined();
    await expect(client(respond('')).deactivate()).resolves.toBeUndefined();
    await expect(client(respond('invalid')).deactivate()).rejects.toBeInstanceOf(
      InvalidApiKeyError
    );
    await expect(client(respond('anything')).deactivate()).rejects.toBeInstanceOf(ServerError);
  });

  it('deactivate sends the legacy key field the endpoint requires', async () => {
    const { client: akismet, fetchMock } = clientWith('deactivated');
    await akismet.deactivate();
    const body = sentBody(fetchMock);
    expect(body.get('key')).toBe(TEST_API_KEY);
    expect(body.get('blog')).toBe(TEST_SITE);
  });

  it('revokeSite accepts "Revoked" and surfaces the server refusal otherwise', async () => {
    await expect(client(respond('Revoked')).revokeSite('123')).resolves.toBeUndefined();
    const e = await client(respond('Activation not found.'))
      .revokeSite('123')
      .catch((error: unknown) => error);
    expect(e).toBeInstanceOf(RequestRejectedError);
    expect((e as Error).message).toContain('Activation not found.');
  });

  it('unrevokeSite accepts "Unrevoked" and surfaces the server refusal otherwise', async () => {
    await expect(client(respond('Unrevoked')).unrevokeSite('123')).resolves.toBeUndefined();
    await expect(
      client(respond('Site could not be unrevoked.')).unrevokeSite('123')
    ).rejects.toBeInstanceOf(RequestRejectedError);
  });

  it('getAccessToken maps an empty body to InvalidApiKeyError and invalid to the same', async () => {
    await expect(client(respond('')).getAccessToken()).rejects.toBeInstanceOf(InvalidApiKeyError);
    await expect(client(respond('invalid')).getAccessToken()).rejects.toBeInstanceOf(
      InvalidApiKeyError
    );
    await expect(client(respond('tok-123')).getAccessToken()).resolves.toBe('tok-123');
  });

  it('getAccessToken rejects a body that is not token-shaped', async () => {
    await expect(
      client(respond('<html><body>Bad gateway</body></html>')).getAccessToken()
    ).rejects.toBeInstanceOf(ServerError);
  });

  // A token with a stray newline is still a live credential, and errors must be safe to log.
  it('getAccessToken never quotes a rejected body', async () => {
    const rejected = client(respond('dG9rZW4=\n')).getAccessToken();
    await expect(rejected).rejects.toBeInstanceOf(ServerError);
    await expect(rejected).rejects.not.toThrow('dG9rZW4=');
  });
});

describe('key parameter per endpoint', () => {
  it('verify-key sends api_key only, never the legacy key field', async () => {
    const { client: akismet, fetchMock } = clientWith('valid');
    await akismet.verifyKey();
    const body = sentBody(fetchMock);
    expect(body.get('api_key')).toBe(TEST_API_KEY);
    expect(body.has('key')).toBe(false);
    expect(body.get('blog')).toBe(TEST_SITE);
  });
});

describe('alerts on success', () => {
  it('verifyKey returns the account alert the server sent with valid', async () => {
    const verification = await client(
      respond('valid', {
        'X-akismet-alert-code': '10501',
        'X-akismet-alert-msg': 'You are close to your monthly limit.',
        'X-akismet-alert-upgrade-url': 'https://akismet.com/account/',
      })
    ).verifyKey();
    expect(verification.alert).toMatchObject({
      code: 10_501,
      message: 'You are close to your monthly limit.',
      upgrade: { url: 'https://akismet.com/account/' },
    });
    expect(verification.alertCleared).toBe(false);
  });

  // An empty alert-code header tells the client to clear an alert it showed before.
  it.each([
    ['verifyKey', 'valid', (c: Akismet) => c.verifyKey()],
    ['check', 'false', (c: Akismet) => c.check(content)],
  ])('%s tells a cleared alert apart from no alert', async (_name, body, call) => {
    const cleared = await call(client(respond(body, { 'X-akismet-alert-code': '' })));
    const none = await call(client(respond(body)));
    expect(cleared.alertCleared).toBe(true);
    expect(none.alertCleared).toBe(false);
    expect(cleared.alert).toBeNull();
  });
});
