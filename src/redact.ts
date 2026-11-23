/**
 * Every error the SDK throws must be safe to log in full, including its cause chain.
 * The API key travels in POST bodies, so transport errors, proxy error pages, and debug
 * headers can all echo it back.
 */

const KEY_PARAM = /\b(api_key|key)=[^&\s'"]+/gi;
const REDACTED = '***';
/** Keeps HTML error pages and runaway server values out of logs. */
const MAX_DIAGNOSTIC_LENGTH = 200;
/** Deep enough for any real transport stack; shallow enough that a runaway chain stays cheap. */
const MAX_CAUSE_DEPTH = 8;

/**
 * The server's own spelling of a key: lowercased, non-alphanumerics stripped, left-padded
 * to 12 characters. It quotes the key this way in alert headers, so `ABCD-EF12-3456` comes
 * back as `abcdef123456`.
 */
function serverNormalizedKey(secret: string): string | null {
  const stripped = secret.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  return stripped === '' ? null : stripped.padStart(12, '0');
}

/**
 * Remove `api_key=`/`key=` query values, every literal or URL-encoded copy of `secret`,
 * and the server-normalized form of `secret` in any letter case.
 */
export function redactSecret(text: string, secret: string | null): string {
  let out = text.replace(KEY_PARAM, (_match, name: string) => `${name}=${REDACTED}`);
  if (secret !== null && secret !== '') {
    out = out.split(secret).join(REDACTED);
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) {
      out = out.split(encoded).join(REDACTED);
    }
    const normalized = serverNormalizedKey(secret);
    if (normalized !== null) {
      // Only [a-z0-9] remain, so the pattern needs no escaping.
      out = out.replaceAll(new RegExp(normalized, 'gi'), () => REDACTED);
    }
  }
  return out;
}

/**
 * Redact, then truncate, never the other way round: truncating first can leave a
 * prefix of the key that exact-match redaction no longer recognizes.
 */
export function safeDiagnostic(text: string, secret: string | null): string {
  const redacted = redactSecret(text, secret);
  return redacted.length > MAX_DIAGNOSTIC_LENGTH
    ? `${redacted.slice(0, MAX_DIAGNOSTIC_LENGTH)}...`
    : redacted;
}

/**
 * Build a loggable copy of a caught error: same name, `code`, and stack shape, with
 * the secret removed from every string and the cause chain sanitized recursively.
 * The original object is never attached, so nothing it references can leak.
 * Cyclic or very deep cause chains end in a marker error instead of recursing.
 */
export function sanitizeCause(error: unknown, secret: string | null): Error | undefined {
  return sanitize(error, secret, new Set(), 0);
}

function sanitize(
  error: unknown,
  secret: string | null,
  seen: Set<Error>,
  depth: number
): Error | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  if (seen.has(error)) {
    return new Error('[circular cause omitted]');
  }
  if (depth >= MAX_CAUSE_DEPTH) {
    return new Error('[cause chain truncated]');
  }
  seen.add(error);

  const safe = new Error(redactSecret(error.message, secret));
  safe.name = redactSecret(error.name, secret);
  if (typeof error.stack === 'string') {
    safe.stack = redactSecret(error.stack, secret);
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    (safe as { code?: string }).code = redactSecret(code, secret);
  }

  const inner = sanitize((error as { cause?: unknown }).cause, secret, seen, depth + 1);
  if (inner !== undefined) {
    (safe as { cause?: Error }).cause = inner;
  }

  return safe;
}
