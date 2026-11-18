import { unexpectedResponse } from '../errors/factories.js';
import { castToInt, optionalDecimal, optionalInt } from './cast.js';

const CONTEXT = 'usage-limit response';

/**
 * Monthly usage for the subscription behind the API key.
 * Wire shape: `limit` is an integer or the string `"none"`;
 * `usage` is an integer; `percentage` is a two-decimal string with a thousands
 * separator above 999.99%, or the integer `0` when there is no limit; `throttled` is
 * boolean. With `extended`: `notice_level` (integer bit value) and `upgrade`
 * (`false` or a plan slug such as `akismet_plus_2`, `contact-us`).
 */
export interface UsageLimit {
  /** Monthly check allowance; `null` when the plan is unlimited. */
  readonly limit: number | null;
  readonly usage: number;
  /** Checks left this month, never below 0; `null` when the plan is unlimited. */
  readonly remaining: number | null;
  /** Share of the limit used this month, as a percentage. `0` when unlimited. */
  readonly percentage: number | null;
  /** Akismet is refusing checks because the limit has been exceeded for too long. */
  readonly throttled: boolean;
  /** Over-limit escalation stage (extended only): 0 none, 1 first month, 2 second, 4 third approaching, 8 third over, 16 four or more. */
  readonly noticeLevel: number | null;
  /** Recommended upgrade (extended only): a plan slug, `contact-us`, or `null` when nothing is recommended. */
  readonly upgrade: string | null;
}

/** Callers gate checks on `limit`, `usage`, and `throttled`, so those stay strict. */
export function parseUsageLimit(data: Record<string, unknown>): UsageLimit {
  for (const key of ['limit', 'usage', 'throttled']) {
    if (!(key in data)) {
      throw unexpectedResponse(`Missing required key "${key}" in ${CONTEXT}`);
    }
  }
  const limit = data.limit === 'none' ? null : castToInt(data.limit, 'limit', CONTEXT);
  const usage = castToInt(data.usage, 'usage', CONTEXT);
  if (typeof data.throttled !== 'boolean') {
    throw unexpectedResponse(`Expected boolean "throttled" in ${CONTEXT}`);
  }
  return {
    limit,
    usage,
    remaining: limit === null ? null : Math.max(0, limit - usage),
    percentage: optionalDecimal(data.percentage),
    throttled: data.throttled,
    noticeLevel: optionalInt(data.notice_level),
    upgrade: typeof data.upgrade === 'string' && data.upgrade !== '' ? data.upgrade : null,
  };
}
