// Shared by every runtime fixture. Each fixture imports the installed package and
// passes it in, so the package resolves through that runtime's own install.

/** A `fetch` that answers every request with `body`, as Akismet would with HTTP 200. */
function answer(body) {
  return async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function smoke(sdk) {
  const options = { apiKey: 'zzzzzzzzzzzz', site: 'https://example.com' };

  const spam = new sdk.Akismet({ ...options, fetch: answer('true') });
  const result = await spam.check({ userIp: '192.0.2.1', body: 'smoke test' });
  if (result.verdict !== sdk.SpamVerdict.Spam || result.isSpam !== true) {
    throw new Error(`expected a spam verdict, got ${JSON.stringify(result)}`);
  }

  const invalid = new sdk.Akismet({ ...options, fetch: answer('invalid') });
  let caught;
  try {
    await invalid.check({ userIp: '192.0.2.1', body: 'smoke test' });
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof sdk.InvalidApiKeyError) || !(caught instanceof sdk.AkismetError)) {
    throw new Error(`expected an InvalidApiKeyError, got ${String(caught)}`);
  }

  return `@automattic/akismet ${sdk.SDK_VERSION}: check() and InvalidApiKeyError ok`;
}
