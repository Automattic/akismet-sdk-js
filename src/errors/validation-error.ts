import { AkismetError } from './akismet-error.js';

export class ValidationError extends AkismetError {
  /** The option or `Content` field that was rejected, such as `userIp` or `timeoutMs`. */
  readonly field: string | null;

  constructor(message: string, field: string | null = null) {
    super(message);
    this.field = field;
  }
}
