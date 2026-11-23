import { invalidValue } from './errors/factories.js';
import { validateUrl } from './validation.js';

/** Matches the Akismet WordPress plugin's HTTP timeout. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** setTimeout treats anything above 2^31 - 1 ms as 1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Trim the key and reject a blank one. */
export function normalizeApiKey(apiKey: string): string {
  // The declared type is no guarantee for JS callers, and trim() would throw a TypeError.
  if (typeof apiKey !== 'string') {
    throw invalidValue('apiKey', 'must be a string');
  }
  const trimmed = apiKey.trim();
  if (trimmed === '') {
    throw invalidValue('apiKey', 'cannot be empty');
  }
  return trimmed;
}

export function normalizeSite(site: string): string {
  validateUrl(site, 'site');
  return site.replace(/\/+$/, '');
}

/** Clamp to what setTimeout can wait, so `Infinity` means no practical limit. */
export function normalizeTimeout(timeoutMs: number): number {
  // The declared type is no guarantee for JS callers, and Math.min would coerce a string.
  if (typeof timeoutMs !== 'number' || Number.isNaN(timeoutMs) || timeoutMs <= 0) {
    throw invalidValue('timeoutMs', 'must be a positive number');
  }
  return Math.min(timeoutMs, MAX_TIMEOUT_MS);
}

/**
 * Reject a value fetch would refuse as a header. It would otherwise fail every call
 * as a retryable `NetworkError` instead of failing once at construction.
 */
export function normalizeUserAgent(userAgent: string | undefined): string | undefined {
  if (userAgent == null) {
    return undefined;
  }
  if (typeof userAgent !== 'string' || /[\r\n\0]/.test(userAgent)) {
    throw invalidValue('applicationUserAgent', 'must be a string without line breaks or NUL');
  }
  return userAgent;
}

export function normalizeRetries(retries: number): number {
  if (!Number.isSafeInteger(retries) || retries < 0) {
    throw invalidValue('retries', 'must be a non-negative integer');
  }
  return retries;
}
