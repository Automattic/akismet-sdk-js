import { AkismetError } from './akismet-error.js';

export class NetworkError extends AkismetError {
  /**
   * `true` when the connection failed before any response arrived. A timeout is `false`:
   * the attempt already waited the full `timeoutMs`. The server may still have
   * processed the request, so a retried check can count twice.
   */
  readonly retryable: boolean;

  constructor(message: string, options: ErrorOptions & { retryable?: boolean } = {}) {
    super(message, options);
    this.retryable = options.retryable ?? false;
  }
}
