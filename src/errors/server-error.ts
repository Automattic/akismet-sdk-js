import { ResponseError } from './response-error.js';

/** A 5xx, or a 200 whose body the SDK cannot interpret. */
export class ServerError extends ResponseError {}
