// Contract tests against the real API in test mode. They catch server drift; the
// mocked wire tests are the merge gate. Run with `npm run test:live`.
import { describe, expect, it } from 'vitest';
import {
  type Content,
  ContentType,
  InvalidApiKeyError,
  StatsInterval,
  SubscriptionStatus,
} from '../../src/index.js';
import { FEEDBACK_SUCCESS_BODY } from '../wire.js';
import { liveClient, only } from './live-client.js';

const content: Content = {
  userIp: '192.0.2.1',
  userAgent: 'akismet-sdk-js live suite',
  body: 'Live contract test.',
  authorName: 'Live Suite',
  type: ContentType.ContactForm,
};

const PLAIN_TEXT = /^text\/plain/;

describe('live API in test mode', () => {
  it('refuses to send a POST that left test mode', async () => {
    const { client, exchanges } = liveClient();
    await expect(client.check(content, { isTest: false })).rejects.toThrow(/without is_test=1/);
    expect(exchanges).toEqual([]);
  });

  it('verify-key answers valid', async () => {
    const { client, exchanges } = liveClient();
    await client.verifyKey();
    expect(only(exchanges)).toMatchObject({ status: 200, body: 'valid' });
  });

  it('answers an unknown key with HTTP 200 and body invalid', async () => {
    const { client, exchanges } = liveClient();
    // Not hex, so it cannot be a user-derived key; 000000000001 and the like can be real.
    await expect(client.verifyKey({ apiKey: 'zzzzzzzzzzzz' })).rejects.toBeInstanceOf(
      InvalidApiKeyError
    );
    expect(only(exchanges)).toMatchObject({ status: 200, body: 'invalid' });
  });

  it('comment-check answers false for ham and true for guaranteed spam, each with a guid', async () => {
    const { client, exchanges } = liveClient();
    const ham = await client.check(content);
    const spam = await client.check({
      ...content,
      authorEmail: 'akismet-guaranteed-spam@example.com',
    });

    expect(exchanges.map((e) => e.body)).toEqual(['false', 'true']);
    expect(ham.isSpam).toBe(false);
    expect(spam.isSpam).toBe(true);
    expect(ham.guid).toMatch(/^[\da-f]{32}$/);
    expect(spam.guid).toMatch(/^[\da-f]{32}$/);
  });

  it('submit-spam and submit-ham acknowledge with one fixed sentence', async () => {
    const { client, exchanges } = liveClient();
    await client.submitSpam(content);
    await client.submitHam(content);

    // Also proves the unit tests' canned feedback body is the one the server sends.
    expect(exchanges.map((e) => e.body)).toEqual([FEEDBACK_SUCCESS_BODY, FEEDBACK_SUCCESS_BODY]);
  });

  it('usage-limit sends JSON as text/plain with a string percentage', async () => {
    const { client, exchanges } = liveClient();
    const usage = await client.getUsageLimit({ extended: true });
    const response = only(exchanges);
    const wire = JSON.parse(response.body) as Record<string, unknown>;

    expect(response.contentType).toMatch(PLAIN_TEXT);
    if (wire.limit === 'none') {
      expect(wire.percentage).toBe(0);
    } else {
      expect(Number.isSafeInteger(wire.limit)).toBe(true);
      expect(wire.percentage).toMatch(/^\d{1,3}(,\d{3})*\.\d{2}$/);
    }
    expect(Number.isSafeInteger(wire.usage)).toBe(true);
    expect(typeof wire.throttled).toBe('boolean');
    expect(Number.isSafeInteger(wire.notice_level)).toBe(true);
    expect(wire.upgrade === false || typeof wire.upgrade === 'string').toBe(true);
    expect(usage.throttled).toBe(wire.throttled);
  });

  it('key-sites keys the list by month and sends counts as strings', async () => {
    const { client, exchanges } = liveClient();
    const sites = await client.getKeySites({ limit: 5 });
    const response = only(exchanges);
    const wire = JSON.parse(response.body) as Record<string, unknown>;
    const buckets = Object.keys(wire).filter((k) => !['limit', 'offset', 'total'].includes(k));

    expect(response.contentType).toMatch(PLAIN_TEXT);
    expect(buckets).toEqual([expect.stringMatching(/^\d{4}-\d{2}$/)]);
    expect(wire).toMatchObject({ limit: 5, offset: 0 });
    expect(Number.isSafeInteger(wire.total)).toBe(true);
    expect(sites.month).toBe(buckets[0]);

    // A key with no traffic this month has no rows; the shape above still holds.
    const rows = wire[buckets[0] as string] as Record<string, unknown>[];
    for (const row of rows) {
      for (const field of ['api_calls', 'spam', 'ham', 'missed_spam', 'false_positives']) {
        expect(row[field]).toMatch(/^\d+$/);
      }
      expect(typeof row.is_revoked).toBe('boolean');
    }
  });

  it('get-subscription sends the account fields and a known status', async () => {
    const { client, exchanges } = liveClient();
    const subscription = await client.getSubscription();
    const wire = JSON.parse(only(exchanges).body) as Record<string, unknown>;

    expect(Number(wire.account_id)).toBeGreaterThan(0);
    expect(typeof wire.account_type).toBe('string');
    expect(typeof wire.account_name).toBe('string');
    expect(Object.values(SubscriptionStatus)).toContain(wire.status);
    expect(
      wire.next_billing_date === false ||
        wire.next_billing_date === null ||
        Number(wire.next_billing_date) > 0
    ).toBe(true);
    expect(typeof wire.limit_reached).toBe('boolean');
    expect(subscription.status).toBe(wire.status);
  });

  // Daily stats have no zero-fill, so a quiet 60-day window can send breakdown as [].
  it.each([StatsInterval.SixtyDays, StatsInterval.SixMonths])(
    'get-key-stats for %s sends numeric totals and a breakdown keyed by period',
    async (interval) => {
      const { client, exchanges } = liveClient();
      const stats = await client.getStats({ interval });
      const wire = JSON.parse(only(exchanges).body) as Record<string, unknown>;

      for (const field of ['spam', 'ham', 'missed_spam', 'false_positives', 'time_saved']) {
        expect(Number.isFinite(Number(wire[field]))).toBe(true);
      }
      expect(Number.isFinite(Number(wire.accuracy))).toBe(true);
      const breakdown = wire.breakdown;
      if (Array.isArray(breakdown)) {
        expect(breakdown).toEqual([]);
      } else {
        expect(typeof breakdown).toBe('object');
        for (const entry of Object.values(breakdown as Record<string, Record<string, unknown>>)) {
          expect(typeof entry.da).toBe('string');
        }
      }
      expect(stats.breakdown.map((entry) => entry.period)).toEqual(
        Array.isArray(breakdown) ? [] : Object.keys(breakdown as object).toSorted()
      );
    }
  );
});
