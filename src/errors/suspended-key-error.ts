import { ResponseError } from './response-error.js';

/**
 * Akismet has disabled this API key. Signalled by `X-akismet-error: suspended` on a
 * check, the body `Invalid key` on feedback, or `invalid` with alert code 10009 on
 * key-level calls such as `verifyKey()` and `getStats()`. Checks will not get a verdict
 * until the account is restored.
 *
 * Other suspensions reach `verifyKey()` and `getStats()` as `InvalidApiKeyError`
 * whose `debugHelp` asks you to contact Akismet support; the server sends no other signal.
 */
export class SuspendedKeyError extends ResponseError {}
