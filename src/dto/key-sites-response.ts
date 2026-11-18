import { unexpectedResponse } from '../errors/factories.js';
import { castToInt } from './cast.js';
import { parseSiteStats, type SiteStats } from './site-stats.js';

const CONTEXT = 'key-sites response';
const MONTH_BUCKET = /^\d{4}-\d{2}$/;

/**
 * Sites that used the API key in one month.
 * Wire shape: `{"2026-10": [site, ...], "limit": 500, "offset": 0, "total": 2}`.
 * The bucket key is the effective month, which the server may have clamped. Keys
 * other than the bucket and the three pagination fields are ignored, so additive
 * server changes do not break parsing. Pagination drives the caller's loop, so it is strict.
 */
export interface KeySitesResponse {
  /** `YYYY-MM` the sites belong to; `null` only when the response has no bucket and `total` is 0. */
  readonly month: string | null;
  readonly sites: readonly SiteStats[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
  /**
   * Pass as `offset` to fetch the next page; `null` on the last page. Pass `month` too,
   * or a loop that runs across a month boundary mixes two months.
   */
  readonly nextOffset: number | null;
}

function page(
  month: string | null,
  sites: SiteStats[],
  limit: number,
  offset: number,
  total: number
): KeySitesResponse {
  const nextOffset = offset + sites.length < total ? offset + limit : null;
  return { month, sites, limit, offset, total, nextOffset };
}

export function parseKeySitesResponse(data: Record<string, unknown>): KeySitesResponse {
  for (const key of ['limit', 'offset', 'total']) {
    if (!(key in data)) {
      throw unexpectedResponse(`Missing required key "${key}" in ${CONTEXT}`);
    }
  }
  const limit = castToInt(data.limit, 'limit', CONTEXT);
  const offset = castToInt(data.offset, 'offset', CONTEXT);
  const total = castToInt(data.total, 'total', CONTEXT);
  if (limit <= 0) {
    // nextOffset would never advance, so a caller's page loop would never end.
    throw unexpectedResponse(`Expected positive "limit" in ${CONTEXT}`);
  }

  const buckets = Object.keys(data).filter((key) => MONTH_BUCKET.test(key));
  if (buckets.length > 1) {
    throw unexpectedResponse(`${CONTEXT} has multiple month buckets (${buckets.join(', ')})`);
  }
  const month = buckets[0] ?? null;
  if (month === null) {
    if (total > 0) {
      throw unexpectedResponse(`${CONTEXT} reports total=${String(total)} but has no month bucket`);
    }
    return page(null, [], limit, offset, total);
  }

  const entries = data[month];
  if (!Array.isArray(entries)) {
    throw unexpectedResponse(`Expected array for month bucket "${month}" in ${CONTEXT}`);
  }
  const sites = entries.map((entry: unknown, i) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw unexpectedResponse(`${CONTEXT} site entry at index ${String(i)} is not an object`);
    }
    return parseSiteStats(entry as Record<string, unknown>);
  });

  return page(month, sites, limit, offset, total);
}
