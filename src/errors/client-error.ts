import { ResponseError } from './response-error.js';

/**
 * A 4xx status. The API itself sends only 405 (wrong HTTP method, an SDK bug);
 * anything else comes from a proxy in front of it.
 */
export class ClientError extends ResponseError {}
