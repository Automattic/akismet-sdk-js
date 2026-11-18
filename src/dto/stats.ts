import { unexpectedResponse } from '../errors/factories.js';
import { castToInt, optionalDecimal, optionalInt, optionalString } from './cast.js';

const CONTEXT = 'get-key-stats response';

/** One period of a stats breakdown. Every field is informational. */
export interface StatsBreakdownEntry {
  /** The bucket the server keyed this entry by, such as `2026-04`. */
  readonly period: string;
  readonly spam: number | null;
  readonly ham: number | null;
  readonly missedSpam: number | null;
  readonly falsePositives: number | null;
  /** Sites active in the period. */
  readonly sites: number | null;
  /** The server's `da` value for the period, as sent. */
  readonly date: string | null;
}

export interface Stats {
  readonly spam: number;
  readonly ham: number;
  readonly missedSpam: number;
  readonly falsePositives: number;
  readonly accuracy: number;
  readonly timeSaved: number;
  /** Sorted by period. */
  readonly breakdown: readonly StatsBreakdownEntry[];
}

// The server sends null for a period with no activity of one kind.
function count(value: unknown): number | null {
  return value === null ? 0 : optionalInt(value);
}

function parseBreakdown(raw: unknown): StatsBreakdownEntry[] {
  // PHP encodes an empty associative array as [], so an interval with no rows arrives that way.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }
  const entries: StatsBreakdownEntry[] = [];
  for (const [period, value] of Object.entries(raw)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    entries.push({
      period,
      spam: count(entry.spam),
      ham: count(entry.ham),
      missedSpam: count(entry.missed_spam),
      falsePositives: count(entry.false_positives),
      sites: count(entry.blogs),
      date: optionalString(entry.da),
    });
  }
  return entries.toSorted((a, b) => a.period.localeCompare(b.period));
}

export function parseStats(data: Record<string, unknown>): Stats {
  for (const key of ['spam', 'ham', 'missed_spam', 'false_positives', 'accuracy', 'time_saved']) {
    if (!(key in data)) {
      throw unexpectedResponse(`Missing required key "${key}" in ${CONTEXT}`);
    }
  }
  const accuracy = optionalDecimal(data.accuracy);
  if (accuracy === null) {
    throw unexpectedResponse(`Expected numeric "accuracy" in ${CONTEXT}`);
  }
  return {
    spam: castToInt(data.spam, 'spam', CONTEXT),
    ham: castToInt(data.ham, 'ham', CONTEXT),
    missedSpam: castToInt(data.missed_spam, 'missed_spam', CONTEXT),
    falsePositives: castToInt(data.false_positives, 'false_positives', CONTEXT),
    accuracy,
    timeSaved: castToInt(data.time_saved, 'time_saved', CONTEXT),
    breakdown: parseBreakdown(data.breakdown),
  };
}
