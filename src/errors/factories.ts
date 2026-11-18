// Internal constructors for the SDK's own errors. The classes keep public constructors so
// callers can throw them in tests; these build the messages the SDK itself uses.
import { ClientError } from './client-error.js';
import { InvalidApiKeyError } from './invalid-api-key-error.js';
import { NetworkError } from './network-error.js';
import { RequestRejectedError } from './request-rejected-error.js';
import type { ResponseDetails } from './response-error.js';
import { ServerError } from './server-error.js';
import { SuspendedKeyError } from './suspended-key-error.js';
import { ThrottledError } from './throttled-error.js';
import { ValidationError } from './validation-error.js';

export function invalidValue(field: string, reason: string): ValidationError {
  return new ValidationError(`Invalid value for ${field}: ${reason}`, field);
}

function statusMessage(kind: string, status: number, body: string): string {
  const message = `Akismet API returned ${kind} error: ${String(status)}`;
  return body === '' ? message : `${message} - ${body}`;
}

export function clientErrorFromStatus(
  status: number,
  body: string,
  details: Partial<ResponseDetails> = {}
): ClientError {
  return new ClientError(statusMessage('client', status, body), { ...details, status });
}

export function serverErrorFromStatus(
  status: number,
  body: string,
  details: Partial<ResponseDetails> = {}
): ServerError {
  return new ServerError(statusMessage('server', status, body), { ...details, status });
}

/**
 * Carries the diagnostic verbatim. Redaction and truncation happen in `Akismet`,
 * in that order, so a shortened message can never expose a prefix of the key.
 */
export function unexpectedResponse(
  diagnostic: string,
  details: Partial<ResponseDetails> = {}
): ServerError {
  return new ServerError(`Unexpected Akismet API response: ${diagnostic}`, details);
}

export function invalidApiKey(details: ResponseDetails): InvalidApiKeyError {
  const message = 'Akismet API key verification failed';
  return new InvalidApiKeyError(
    details.debugHelp === null ? message : `${message}: ${details.debugHelp}`,
    details
  );
}

export function requestRejected(reason: string, details: ResponseDetails): RequestRejectedError {
  return new RequestRejectedError(`Akismet rejected the request: ${reason}`, details);
}

export function suspendedKey(details: ResponseDetails): SuspendedKeyError {
  return new SuspendedKeyError(
    details.alert?.message ?? 'Akismet API key is suspended; contact akismet.com support',
    details
  );
}

export function throttled(details: ResponseDetails): ThrottledError {
  return new ThrottledError(
    details.alert?.message ?? "Akismet usage has exceeded the subscription's monthly limit",
    details
  );
}

export function networkTimeout(cause?: Error): NetworkError {
  return new NetworkError('Akismet API request timed out', { cause, retryable: false });
}

export function networkFailure(endpoint: string, message: string, cause?: Error): NetworkError {
  return new NetworkError(`Akismet API request to ${endpoint} failed: ${message}`, {
    cause,
    retryable: true,
  });
}

export function networkMidStream(endpoint: string, message: string, cause?: Error): NetworkError {
  return new NetworkError(`Akismet API response to ${endpoint} failed mid-stream: ${message}`, {
    cause,
    retryable: false,
  });
}
