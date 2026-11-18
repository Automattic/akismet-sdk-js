import { ResponseError } from './response-error.js';

/**
 * Akismet is refusing checks because the subscription's monthly usage limit has been
 * exceeded for too long. Not a per-second rate limit: there is nothing to wait for.
 * Signalled by body `invalid` with alert code 10508. Key verification, usage-limit,
 * and key-sites calls still work while throttled.
 */
export class ThrottledError extends ResponseError {}
