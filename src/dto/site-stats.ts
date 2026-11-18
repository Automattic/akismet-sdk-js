import { unexpectedResponse } from '../errors/factories.js';
import { optionalBool, optionalInt, optionalString } from './cast.js';

const CONTEXT = 'site stats';

/**
 * One site's activity in a key-sites month bucket. The site's identity is strict; its
 * counts and extended fields are informational and read as `null` when malformed.
 * Wire shape: numeric fields arrive as strings; `is_revoked` is boolean; with
 * `extended`, `hash` is a decimal string and `eligible_for_revoke` is boolean.
 */
export interface SiteStats {
  readonly site: string;
  readonly totalCalls: number | null;
  readonly spam: number | null;
  readonly ham: number | null;
  readonly missedSpam: number | null;
  readonly falsePositives: number | null;
  /** Share of calls Akismet got right, 0-100; `null` without calls to judge. */
  readonly accuracy: number | null;
  readonly isRevoked: boolean | null;
  /** Present only when `extended: true` is passed to `getKeySites()`. Pass to `revokeSite()`. */
  readonly hash: string | null;
  /** Present only when `extended: true` is passed to `getKeySites()`. False for WordPress.com sites. */
  readonly eligibleForRevoke: boolean | null;
}

function accuracyOf(
  totalCalls: number | null,
  missedSpam: number | null,
  falsePositives: number | null
): number | null {
  if (totalCalls === null || totalCalls === 0 || missedSpam === null || falsePositives === null) {
    return null;
  }
  const accuracy = Math.round((1 - (missedSpam + falsePositives) / totalCalls) * 100 * 100) / 100;
  return Math.max(0, Math.min(100, accuracy));
}

export function parseSiteStats(data: Record<string, unknown>): SiteStats {
  if (typeof data.site !== 'string' || data.site === '') {
    throw unexpectedResponse(`Expected non-empty string "site" in ${CONTEXT}`);
  }
  const totalCalls = optionalInt(data.api_calls);
  const missedSpam = optionalInt(data.missed_spam);
  const falsePositives = optionalInt(data.false_positives);
  return {
    site: data.site,
    totalCalls,
    spam: optionalInt(data.spam),
    ham: optionalInt(data.ham),
    missedSpam,
    falsePositives,
    accuracy: accuracyOf(totalCalls, missedSpam, falsePositives),
    isRevoked: optionalBool(data.is_revoked),
    hash: optionalString(data.hash),
    eligibleForRevoke: optionalBool(data.eligible_for_revoke),
  };
}
