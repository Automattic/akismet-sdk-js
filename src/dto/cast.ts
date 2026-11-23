import { unexpectedResponse } from '../errors/factories.js';
/**
 * An informational integer: a finite `number` (truncated toward zero) or a string of
 * digits with an optional minus sign, either one a safe integer. Anything else,
 * including blanks and hex that `Number()` would accept, is `null`.
 */
export function optionalInt(value: unknown): number | null {
  if (typeof value === 'number') {
    const truncated = Math.trunc(value);
    return Number.isSafeInteger(truncated) ? truncated : null;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    // A digit string can still overflow, or lose precision past 2^53.
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * An informational decimal: a finite `number`, or `number_format()` output such as
 * `"12.34"` or `"1,234.57"`. Blanks and hex, which `Number()` would accept, are `null`.
 */
export function optionalDecimal(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(value)) {
    return Number(value.replaceAll(',', ''));
  }
  return null;
}

/** A non-negative integer header; absent, empty, or anything else reads as `null`. */
export function headerInt(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

/** A required integer field: the forms {@link optionalInt} accepts, else the response is unexpected. */
export function castToInt(value: unknown, field: string, context: string): number {
  const parsed = optionalInt(value);
  if (parsed === null) {
    throw unexpectedResponse(`Expected numeric "${field}" in ${context}`);
  }
  return parsed;
}

/** An informational string; anything else, or an empty string, is `null`. */
export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** An informational boolean; anything else is `null`. */
export function optionalBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
