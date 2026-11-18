import type { Alert } from '../dto/alert.js';
import { AkismetError } from './akismet-error.js';

/**
 * What the server said, attached to every error derived from a response. Header
 * values are redacted before they get here, so the whole object is safe to log.
 */
export interface ResponseDetails {
  /** HTTP status. Almost always 200: the API signals errors in the body and headers. */
  readonly status: number | null;
  /** Lower-cased response headers. */
  readonly headers: Readonly<Record<string, string>>;
  /** `X-akismet-debug-help`: why the request was rejected, when the server says. */
  readonly debugHelp: string | null;
  /** The account alert sent with the error, such as the usage-limit notice. */
  readonly alert: Alert | null;
}

/** Base for errors built from a server response. */
export abstract class ResponseError extends AkismetError implements ResponseDetails {
  readonly status: number | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly debugHelp: string | null;
  readonly alert: Alert | null;

  constructor(message: string, details: Partial<ResponseDetails> = {}, options?: ErrorOptions) {
    super(message, options);
    this.status = details.status ?? null;
    this.headers = details.headers ?? {};
    this.debugHelp = details.debugHelp ?? null;
    this.alert = details.alert ?? null;
  }
}
