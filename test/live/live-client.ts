import { Akismet } from '../../src/index.js';

/** One response exactly as the server sent it, before the SDK parsed anything. */
export interface Exchange {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

const apiKey = process.env.AKISMET_TEST_API_KEY ?? '';
if (apiKey === '') {
  // A nightly run with a missing secret must fail, not pass as a page of skips.
  throw new Error('AKISMET_TEST_API_KEY is not set; the live suite refuses to run without it.');
}

const SITE = process.env.AKISMET_TEST_SITE || 'https://example.com';

/**
 * A test-mode client whose fetch records every response. It refuses any POST without
 * `is_test=1` before the request leaves, because such a call trains the account's filter.
 */
export function liveClient(): { client: Akismet; exchanges: Exchange[] } {
  const exchanges: Exchange[] = [];
  const recordingFetch: typeof fetch = async (input, init) => {
    const method = init?.method ?? 'GET';
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // Path only in the message: a query string could carry the API key.
    const path = new URL(url).pathname;
    // The SDK sends form bodies as strings; anything else counts as missing the flag.
    const body = typeof init?.body === 'string' ? init.body : '';
    if (method === 'POST' && new URLSearchParams(body).get('is_test') !== '1') {
      throw new Error(`Refusing a live POST to ${path} without is_test=1`);
    }
    const response = await fetch(input, init);
    exchanges.push({
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: await response.clone().text(),
    });
    return response;
  };
  const client = new Akismet({ apiKey, site: SITE, isTest: true, fetch: recordingFetch });
  return { client, exchanges };
}

/** The single response a one-call test made. */
export function only(exchanges: Exchange[]): Exchange {
  if (exchanges.length !== 1) {
    throw new Error(`Expected one response, got ${String(exchanges.length)}`);
  }
  return exchanges[0] as Exchange;
}
