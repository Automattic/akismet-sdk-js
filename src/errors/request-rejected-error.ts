import { ResponseError } from './response-error.js';

/**
 * The server understood the request and refused it for a reason other than the key:
 * a missing or malformed `blog`, a site this key is not authorized for (alert 10403),
 * or a revoke/unrevoke that found nothing. The server's own words are in the message.
 */
export class RequestRejectedError extends ResponseError {}
