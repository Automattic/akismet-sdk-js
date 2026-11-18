import { type Mock, vi } from 'vitest';
import { Akismet, type AkismetOptions, type Content, type FetchLike } from '../src/index.js';

/** Realistic length so redaction never mangles unrelated text, with no literal that scans as a secret. */
export const TEST_API_KEY = 'a'.repeat(12);
export const TEST_SITE = 'https://example.com';
/** What the feedback endpoints answer on success. */
export const FEEDBACK_SUCCESS_BODY = 'Thanks for making the web a better place.';
/** Minimal valid usage-limit and key-stats answers. */
export const USAGE_BODY = JSON.stringify({
  limit: 100,
  usage: 1,
  percentage: '1.00',
  throttled: false,
});
export const STATS_BODY = JSON.stringify({
  spam: 0,
  ham: 0,
  missed_spam: 0,
  false_positives: 0,
  accuracy: 0,
  time_saved: 0,
});

type FetchMock = Mock<FetchLike>;

/** A client with the test key and site over `fetch`; `options` override the client defaults. */
export function clientOver(fetch: FetchLike, options: Partial<AkismetOptions> = {}): Akismet {
  return new Akismet({ apiKey: TEST_API_KEY, site: TEST_SITE, fetch, ...options });
}

/** A client whose every request gets `body` back with HTTP 200. */
export function clientWith(
  body: string,
  headers: Record<string, string> = {}
): { client: Akismet; fetchMock: FetchMock } {
  const fetchMock = vi
    .fn<FetchLike>()
    .mockImplementation(() => Promise.resolve(new Response(body, { status: 200, headers })));
  return { client: clientOver(fetchMock), fetchMock };
}

/** The form body of the n-th request the mock received. */
export function sentBody(
  fetchMock: { mock: { calls: readonly unknown[][] } },
  call = 0
): URLSearchParams {
  const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return new URLSearchParams(init.body as string);
}

/** What `check()` puts on the wire for this content. Assertions on the body are the contract. */
export async function checkWire(content: Content): Promise<URLSearchParams> {
  const { client, fetchMock } = clientWith('false');
  await client.check(content);
  return sentBody(fetchMock);
}

/** What `submitSpam()` puts on the wire for this content. */
export async function feedbackWire(content: Content): Promise<URLSearchParams> {
  const { client, fetchMock } = clientWith(FEEDBACK_SUCCESS_BODY);
  await client.submitSpam(content);
  return sentBody(fetchMock);
}
