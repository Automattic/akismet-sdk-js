import { headerInt, optionalString } from './cast.js';

/** Where to send the account to lift a usage-limit alert. */
export interface AlertUpgrade {
  readonly plan: string | null;
  readonly url: string | null;
  readonly type: string | null;
  /** The upgrade needs a conversation with Akismet support. */
  readonly viaSupport: boolean;
}

/** An account-level notice Akismet attached to a response. */
export interface Alert {
  /** For example 10501-10516 for usage limits. */
  readonly code: number;
  readonly message: string | null;
  /** Calls made this month; usage-limit alerts only. */
  readonly apiCalls: number | null;
  /** The monthly limit; usage-limit alerts only. */
  readonly usageLimit: number | null;
  readonly upgrade: AlertUpgrade | null;
}

/** True when the response carries an empty alert code: the server's signal to clear a shown alert. */
export function isAlertCleared(headers: Readonly<Record<string, string>>): boolean {
  return headers['x-akismet-alert-code'] === '';
}

/**
 * The alert in lower-cased `headers`, or `null` when there is no alert code. Pass
 * `message` when it must be redacted first, as it must on an error.
 */
export function alertFromHeaders(
  headers: Readonly<Record<string, string>>,
  message: string | null = optionalString(headers['x-akismet-alert-msg'])
): Alert | null {
  // An empty code is the server's signal to clear a shown alert, not an alert.
  const code = headerInt(headers['x-akismet-alert-code']);
  if (code === null) {
    return null;
  }
  const plan = optionalString(headers['x-akismet-alert-upgrade-plan']);
  const url = optionalString(headers['x-akismet-alert-upgrade-url']);
  const type = optionalString(headers['x-akismet-alert-upgrade-type']);
  const viaSupport = headers['x-akismet-alert-upgrade-via-support'] === 'true';
  return {
    code,
    message,
    apiCalls: headerInt(headers['x-akismet-alert-api-calls']),
    usageLimit: headerInt(headers['x-akismet-alert-usage-limit']),
    upgrade:
      plan === null && url === null && type === null && !viaSupport
        ? null
        : { plan, url, type, viaSupport },
  };
}
