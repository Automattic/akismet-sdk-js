import { ResponseError } from './response-error.js';

/**
 * The server answered `invalid`: the key is unknown, empty, or malformed, or the
 * site could not be parsed. `debugHelp` says which when the server tells us.
 */
export class InvalidApiKeyError extends ResponseError {}
