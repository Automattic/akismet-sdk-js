import { type SubscriptionStatus } from '../enums.js';
import { optionalBool, optionalInt, optionalString } from './cast.js';

/**
 * The plan behind the API key. Every field is informational, so a value the SDK does
 * not recognize reads as `null` instead of failing the call.
 */
export interface Subscription {
  readonly accountId: number | null;
  readonly slug: string | null;
  readonly displayName: string | null;
  /** A known status, or the server's string as sent when it is new to this SDK. */
  readonly status: SubscriptionStatus | (string & {}) | null;
  /** Next renewal; `null` when nothing will be billed (free plans) or the value is unrecognized. */
  readonly nextBillingDate: Date | null;
  readonly limitReached: boolean | null;
}

/** The wire sends Unix seconds, or `false` when nothing will be billed. */
function parseBillingDate(value: unknown): Date | null {
  const seconds = optionalInt(value);
  return seconds === null || seconds <= 0 ? null : new Date(seconds * 1000);
}

export function parseSubscription(data: Record<string, unknown>): Subscription {
  const accountId = optionalInt(data.account_id);
  return {
    accountId: accountId !== null && accountId > 0 ? accountId : null,
    slug: optionalString(data.account_type),
    displayName: optionalString(data.account_name),
    status: optionalString(data.status),
    nextBillingDate: parseBillingDate(data.next_billing_date),
    limitReached: optionalBool(data.limit_reached),
  };
}
