import { SpamVerdict } from '../enums.js';
import { type Alert, alertFromHeaders, isAlertCleared } from './alert.js';
import { headerInt, optionalString } from './cast.js';

/** Akismet's answer to a check. A plain object: store it with `JSON.stringify` as it is. */
export interface CheckResult {
  readonly verdict: SpamVerdict;
  /** Spam or discard: `discard` is spam Akismet is sure of. */
  readonly isSpam: boolean;
  readonly proTip: string | null;
  readonly debugHelp: string | null;
  /** Identifies this check in Akismet's logs. */
  readonly guid: string | null;
  /** Seconds after which Akismet suggests checking again; `null` when it does not. */
  readonly recheckAfter: number | null;
  /** Value of the `x-akismet-classification` header when `classify` was requested. */
  readonly classification: string | null;
  readonly alert: Alert | null;
  /** The server sent an empty alert code: remove any alert you stored for this key. */
  readonly alertCleared: boolean;
}

function parseRecheckAfter(value: string | undefined): number | null {
  const seconds = headerInt(value);
  return seconds !== null && seconds > 0 ? seconds : null;
}

/** `headers` have lower-case names. */
export function parseCheckResult(
  body: 'true' | 'false',
  headers: Readonly<Record<string, string>>
): CheckResult {
  const proTip = optionalString(headers['x-akismet-pro-tip']);
  let verdict: SpamVerdict = SpamVerdict.Ham;
  if (body === 'true') {
    verdict = proTip === 'discard' ? SpamVerdict.Discard : SpamVerdict.Spam;
  }
  return {
    verdict,
    isSpam: verdict !== SpamVerdict.Ham,
    proTip,
    debugHelp: optionalString(headers['x-akismet-debug-help']),
    guid: optionalString(headers['x-akismet-guid']),
    recheckAfter: parseRecheckAfter(headers['x-akismet-recheck-after']),
    classification: optionalString(headers['x-akismet-classification']),
    alert: alertFromHeaders(headers),
    alertCleared: isAlertCleared(headers),
  };
}
