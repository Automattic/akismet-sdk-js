import { type Alert, alertFromHeaders, isAlertCleared } from './alert.js';

/**
 * What a successful `verifyKey()` learned besides "the key works": an account alert
 * to show in a setup or settings screen, or the signal to clear one shown before.
 */
export interface KeyVerification {
  readonly alert: Alert | null;
  /** The server sent an empty alert code: remove any alert you stored for this key. */
  readonly alertCleared: boolean;
}

/** `headers` must have lower-case names, as the SDK's transport provides them. */
export function parseKeyVerification(headers: Readonly<Record<string, string>>): KeyVerification {
  return { alert: alertFromHeaders(headers), alertCleared: isAlertCleared(headers) };
}
