import { describe, expect, it } from 'vitest';
import { ServerError, SpamVerdict, type GetUsageLimitOptions } from '../src/index.js';
import { clientWith, sentBody } from './wire.js';

function check(body: 'true' | 'false', headers: Record<string, string> = {}) {
  return clientWith(body, headers).client.check({ userIp: '192.0.2.1' });
}

async function usageLimit(data: Record<string, unknown>, options?: GetUsageLimitOptions) {
  return clientWith(JSON.stringify(data)).client.getUsageLimit(options);
}

async function subscription(data: Record<string, unknown>) {
  return clientWith(JSON.stringify(data)).client.getSubscription();
}

async function stats(data: Record<string, unknown>) {
  return clientWith(JSON.stringify(data)).client.getStats();
}

async function keySites(data: Record<string, unknown>) {
  return clientWith(JSON.stringify(data)).client.getKeySites();
}

describe('check results', () => {
  it.each([
    ['false', {}, SpamVerdict.Ham, false],
    ['true', {}, SpamVerdict.Spam, true],
    ['true', { 'X-akismet-pro-tip': 'discard' }, SpamVerdict.Discard, true],
  ] as const)('%s with %j is %s, isSpam %s', async (body, headers, verdict, isSpam) => {
    const result = await check(body, headers);
    expect(result.verdict).toBe(verdict);
    expect(result.isSpam).toBe(isSpam);
  });

  it('reads recheck-after and classification', async () => {
    const result = await check('false', {
      'X-akismet-recheck-after': '30',
      'X-akismet-classification': 'toxic',
    });
    expect(result.recheckAfter).toBe(30);
    expect(result.classification).toBe('toxic');
  });

  it('groups the alert headers into one alert', async () => {
    const result = await check('false', {
      'X-akismet-alert-code': '10501',
      'X-akismet-alert-msg': 'Approaching the limit',
      'X-akismet-alert-api-calls': '1234',
      'X-akismet-alert-usage-limit': '5000',
      'X-akismet-alert-upgrade-plan': 'pro',
      'X-akismet-alert-upgrade-url': 'https://akismet.com/upgrade',
      'X-akismet-alert-upgrade-via-support': 'true',
    });
    expect(result.alert).toEqual({
      code: 10_501,
      message: 'Approaching the limit',
      apiCalls: 1234,
      usageLimit: 5000,
      upgrade: {
        plan: 'pro',
        url: 'https://akismet.com/upgrade',
        type: null,
        viaSupport: true,
      },
    });
    expect(result.alertCleared).toBe(false);
  });

  it('has no upgrade when the alert carries no upgrade headers', async () => {
    const result = await check('false', { 'X-akismet-alert-code': '10501' });
    expect(result.alert?.upgrade).toBeNull();
  });

  // Integrators store the result as JSON; a plain object must come back unchanged.
  it('survives a JSON round trip', async () => {
    const result = await check('true', {
      'X-akismet-pro-tip': 'discard',
      'X-akismet-guid': 'f'.repeat(32),
      'X-akismet-alert-code': '10508',
      'X-akismet-alert-upgrade-url': 'https://akismet.com/account/',
    });
    // eslint-disable-next-line unicorn/prefer-structured-clone -- the JSON round trip is the point
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('usage limit', () => {
  const limited = { limit: 5000, usage: 1234, percentage: '24.68', throttled: false };

  it('parses the limited shape', async () => {
    const u = await usageLimit(limited);
    expect(u).toMatchObject({ limit: 5000, usage: 1234, remaining: 3766, throttled: false });
    expect(u.percentage).toBeCloseTo(24.68);
    expect(u.noticeLevel).toBeNull();
    expect(u.upgrade).toBeNull();
  });

  it('strips the thousands separator number_format adds above 999.99%', async () => {
    const u = await usageLimit({ ...limited, usage: 123_457, percentage: '123,457.00' });
    expect(u.percentage).toBeCloseTo(123_457);
    expect(u.remaining).toBe(0);
  });

  it('maps "none" to an unlimited plan', async () => {
    const u = await usageLimit({ limit: 'none', usage: 10, percentage: 0, throttled: false });
    expect(u).toMatchObject({ limit: null, remaining: null, percentage: 0 });
  });

  it('asks for the extended fields only when told to, and parses them', async () => {
    const { client, fetchMock } = clientWith(
      JSON.stringify({ ...limited, notice_level: 8, upgrade: 'akismet_plus_2' })
    );
    await client.getUsageLimit();
    const u = await client.getUsageLimit({ extended: true });
    expect([
      sentBody(fetchMock, 0).get('extended'),
      sentBody(fetchMock, 1).get('extended'),
    ]).toEqual([null, 'true']);
    expect(u.noticeLevel).toBe(8);
    expect(u.upgrade).toBe('akismet_plus_2');
    const none = await usageLimit({ ...limited, notice_level: 0, upgrade: false });
    expect(none.upgrade).toBeNull();
  });

  // Callers gate checks on these, so a value the SDK cannot trust must fail loudly.
  it.each([
    [{ limit: 'abc' }, 'non-numeric limit'],
    [{ usage: '12.5' }, 'fractional usage'],
    [{ throttled: 'false' }, 'string throttled'],
    [{ usage: undefined }, 'missing usage'],
  ])('throws on %j (%s)', async (override, _label) => {
    await expect(usageLimit({ ...limited, ...override })).rejects.toBeInstanceOf(ServerError);
  });

  it.each([' ', '0x10', '1e3', '9'.repeat(309), '9007199254740993', 1e300])(
    'rejects the non-integer or unsafe usage %j',
    async (usage) => {
      await expect(usageLimit({ ...limited, usage })).rejects.toBeInstanceOf(ServerError);
    }
  );

  // Informational fields: a server change there must not break a quota gate.
  it.each([
    [{ percentage: true }, 'percentage'],
    [{ percentage: '12.34.56' }, 'percentage'],
    [{ notice_level: 'high' }, 'noticeLevel'],
    [{ upgrade: { plan: 'pro' } }, 'upgrade'],
    [{ upgrade: true }, 'upgrade'],
  ])('reads %j as a null %s', async (override, field) => {
    const u = await usageLimit({ ...limited, ...override });
    expect(u[field as keyof typeof u]).toBeNull();
    expect(u.usage).toBe(1234);
  });
});

describe('subscription', () => {
  const paid = {
    account_id: 42,
    account_type: 'pro',
    account_name: 'Pro Plan',
    status: 'active',
    next_billing_date: 1_700_000_000,
    limit_reached: false,
  };

  it('reads the billing date from Unix seconds', async () => {
    const sub = await subscription(paid);
    expect(sub.nextBillingDate?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(sub).toMatchObject({ accountId: 42, status: 'active' });
  });

  it('reads false as no billing date', async () => {
    const sub = await subscription({ ...paid, next_billing_date: false });
    expect(sub.nextBillingDate).toBeNull();
  });

  it('keeps a status this SDK does not know', async () => {
    const sub = await subscription({ ...paid, status: 'paused' });
    expect(sub.status).toBe('paused');
  });

  it('reads malformed or missing fields as null instead of failing', async () => {
    const sub = await subscription({ account_id: 'x', status: 7, limit_reached: 'no' });
    expect(sub).toMatchObject({
      accountId: null,
      slug: null,
      status: null,
      nextBillingDate: null,
      limitReached: null,
    });
  });
});

describe('stats', () => {
  const totals = {
    spam: '10',
    ham: 20,
    missed_spam: 1,
    false_positives: 0,
    accuracy: '99.5',
    time_saved: 1234,
  };
  const entry = {
    spam: 10,
    ham: 20,
    missed_spam: 1,
    false_positives: 0,
    blogs: 5,
    da: '2026-04-15',
  };

  it('returns the breakdown as an array sorted by period', async () => {
    const s = await stats({ ...totals, breakdown: { '2026-05': entry, '2026-04': entry } });
    expect(s.accuracy).toBe(99.5);
    expect(s.breakdown.map((e) => e.period)).toEqual(['2026-04', '2026-05']);
    expect(s.breakdown[0]).toMatchObject({ sites: 5, date: '2026-04-15', missedSpam: 1 });
  });

  // PHP encodes an empty associative array as [].
  it('reads an empty array breakdown as no periods', async () => {
    const s = await stats({ ...totals, breakdown: [] });
    expect(s.breakdown).toEqual([]);
  });

  it('skips a malformed period and reads malformed counts as null', async () => {
    const s = await stats({
      ...totals,
      breakdown: { '2026-04': 'nope', '2026-05': { ...entry, spam: 'lots' } },
    });
    expect(s.breakdown).toHaveLength(1);
    expect(s.breakdown[0]?.spam).toBeNull();
  });

  it.each(['n/a', '', '0x10'])('throws on accuracy %j', async (accuracy) => {
    await expect(stats({ ...totals, accuracy })).rejects.toBeInstanceOf(ServerError);
  });
});

describe('key sites', () => {
  /** Exactly what the key-sites endpoint sends: numbers as strings, booleans as booleans. */
  const site = {
    site: 'example.com',
    api_calls: '1000',
    spam: '434',
    ham: '544',
    missed_spam: '5',
    false_positives: '2',
    is_revoked: false,
  };
  const bucket = (sites: unknown[], extra: Record<string, unknown> = {}) => ({
    '2026-10': sites,
    limit: 500,
    offset: 0,
    total: sites.length,
    ...extra,
  });

  it('parses the month-bucketed shape with numeric strings', async () => {
    const resp = await keySites(bucket([site, { ...site, site: 'b.example', is_revoked: true }]));
    expect(resp.month).toBe('2026-10');
    expect(resp.sites[0]).toMatchObject({ site: 'example.com', totalCalls: 1000, accuracy: 99.3 });
    expect(resp.sites[1]?.isRevoked).toBe(true);
    expect(resp.nextOffset).toBeNull();
  });

  it('points at the next page while more sites remain', async () => {
    const resp = await keySites({ '2026-10': [site], limit: 1, offset: 0, total: 3 });
    expect(resp.nextOffset).toBe(1);
  });

  it('tolerates a quiet month, with or without a bucket', async () => {
    const empty = await keySites({ '2026-10': [], limit: 500, offset: 0, total: 0 });
    expect(empty.sites).toEqual([]);
    const noBucket = await keySites({ limit: 500, offset: 0, total: 0 });
    expect(noBucket.month).toBeNull();
  });

  it('ignores unknown keys and non-month arrays', async () => {
    const resp = await keySites(bucket([site], { sites: [{ bogus: true }], note: 'ignored' }));
    expect(resp.sites).toHaveLength(1);
  });

  // Pagination and the bucket drive the caller's loop, so their shape stays strict.
  it.each([
    [{ limit: 500, offset: 0, total: 5 }, 'no bucket'],
    [{ '2026-10': [], '2026-09': [], limit: 500, offset: 0, total: 0 }, 'two buckets'],
    [{ '2026-10': 'nope', limit: 500, offset: 0, total: 1 }, 'bucket not an array'],
    [bucket(['nope']), 'entry not an object'],
    [bucket([{ ...site, site: '' }]), 'empty site'],
    [{ '2026-10': [], offset: 0, total: 0 }, 'missing limit'],
    [{ '2026-10': [site], limit: 0, offset: 0, total: 5 }, 'zero limit'],
    [{ '2026-10': [site], limit: -1, offset: 0, total: 5 }, 'negative limit'],
  ])('throws on %j (%s)', async (data, _label) => {
    await expect(keySites(data)).rejects.toBeInstanceOf(ServerError);
  });

  it('exposes the extended fields, null when absent', async () => {
    const extended = await keySites(
      bucket([{ ...site, hash: '12345678901234567890', eligible_for_revoke: true }])
    );
    expect(extended.sites[0]).toMatchObject({
      hash: '12345678901234567890',
      eligibleForRevoke: true,
    });
    const plain = await keySites(bucket([site]));
    expect(plain.sites[0]).toMatchObject({ hash: null, eligibleForRevoke: null });
  });

  it.each([
    [{ hash: 123 }, 'hash'],
    [{ hash: '' }, 'hash'],
    [{ eligible_for_revoke: 'true' }, 'eligibleForRevoke'],
    [{ is_revoked: 'false' }, 'isRevoked'],
    [{ api_calls: 'lots' }, 'totalCalls'],
  ])('reads %j as a null %s', async (override, field) => {
    const resp = await keySites(bucket([{ ...site, ...override }]));
    const parsed = resp.sites[0];
    expect(parsed?.[field as keyof typeof parsed]).toBeNull();
    expect(parsed?.site).toBe('example.com');
  });
});
