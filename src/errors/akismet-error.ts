/** Base class for all Akismet SDK errors. */
export abstract class AkismetError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
