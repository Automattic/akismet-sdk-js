import type { ContentType } from './enums.js';
import { invalidValue } from './errors/factories.js';
import { normalizeIp } from './ip.js';
import { validateIp, validateUrl } from './validation.js';

/** Wire fields the SDK writes itself. A caller-chosen key may not collide with one. */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'user_ip',
  'user_agent',
  'blog_lang',
  'blog_charset',
  'comment_content',
  'comment_author',
  'comment_author_email',
  'comment_author_url',
  'comment_type',
  'permalink',
  'referrer',
  'comment_date_gmt',
  'comment_post_modified_gmt',
  'comment_parent',
  'user_role',
  // user_id and user_ID change the server's verdict; they must never come from a client.
  'user_id',
  'user_ID',
  'recheck_reason',
  'honeypot_field_name',
  'comment_context',
  'api_key',
  // Legacy name for api_key; the server reads it first, so it must never come from a client.
  'key',
  'blog',
  'is_test',
  'reporter',
  'comment_check_response',
  'callback',
  'classify',
]);

/**
 * Caller-chosen wire keys (honeypot field name, server-variable names) must be plain
 * identifiers. The API parses the form with PHP's `$_POST`, which rewrites `.`, spaces,
 * and brackets and truncates at NUL, so any other character could turn an innocent
 * name into a reserved one such as `user_role`. Allowlisting the alphabet makes that
 * impossible by construction.
 */
const WIRE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Names that read through the prototype, never from a submitted form's own fields. */
export const PROTOTYPE_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
const WIRE_KEY_RULE = 'may contain only letters, digits, underscores, and hyphens';

// The server reads these names as request metadata (legacy key, request URI, peer address,
// forwarded headers), so a form must never be able to choose them. Server variables may use
// them: the caller sets those, and forwarded headers arrive as HTTP_*.
const SERVER_READ_NAMES: ReadonlySet<string> = new Set(['key', 'request_uri', 'remote_addr']);

function isServerReadName(name: string): boolean {
  const lower = name.toLowerCase();
  return SERVER_READ_NAMES.has(lower) || lower.startsWith('http_');
}

const STRING_FIELDS = [
  'userAgent',
  'body',
  'authorName',
  'authorEmail',
  'authorUrl',
  'type',
  'permalink',
  'referrer',
  'parentId',
  'userRole',
  'recheckReason',
  'honeypotFieldName',
  'honeypotFieldValue',
  'callback',
] as const satisfies readonly (keyof Content)[];

/**
 * Content often comes from a parsed JSON body, so the declared types are not a guarantee.
 * A number or array in a string field would otherwise fail as a TypeError or be sent twice.
 */
function validateValueTypes(content: Content): void {
  if (typeof (content.userIp as unknown) !== 'string') {
    throw invalidValue('userIp', 'must be a valid IP address');
  }
  for (const field of STRING_FIELDS) {
    const value: unknown = content[field];
    if (value !== null && value !== undefined && typeof value !== 'string') {
      throw invalidValue(field, 'must be a string');
    }
  }
  for (const field of ['siteLanguages', 'context'] as const) {
    const value: unknown = content[field];
    if (
      value !== null &&
      value !== undefined &&
      typeof value !== 'string' &&
      !(Array.isArray(value) && value.every((item) => typeof item === 'string'))
    ) {
      throw invalidValue(field, 'must be a string or an array of strings');
    }
  }
  for (const [key, value] of Object.entries(content.serverVariables ?? {})) {
    if (typeof value !== 'string') {
      throw invalidValue('serverVariables', `value of ${JSON.stringify(key)} must be a string`);
    }
  }
}

/**
 * The user-submitted item to check, with the context Akismet uses to judge it.
 * A plain object: build it yourself, or from a request with `akismet.forRequest()` or
 * {@link import('./content-factory.js').contentFromRequest}. The client validates it when a
 * request is made.
 */
export interface Content {
  /** The author's client IP as your server observed it. `forRequest()` derives it from the request. */
  userIp: string;
  userAgent?: string | null | undefined;
  /** Languages in use on the site, such as `['en', 'fr_ca']`. Sent as `blog_lang`. */
  siteLanguages?: string | readonly string[] | null | undefined;
  body?: string | null | undefined;
  authorName?: string | null | undefined;
  authorEmail?: string | null | undefined;
  authorUrl?: string | null | undefined;
  /** A {@link ContentType}, or any other `comment_type` value Akismet accepts. */
  type?: ContentType | (string & {}) | null | undefined;
  permalink?: string | null | undefined;
  referrer?: string | null | undefined;
  /**
   * When the author created the content. A string must be an ISO 8601 date-time with a
   * zone, as `JSON.stringify` writes it. Akismet ignores feedback older than 10 days.
   */
  createdAt?: Date | string | null | undefined;
  /** When the page the content belongs to last changed. Same format as `createdAt`. */
  postModifiedAt?: Date | string | null | undefined;
  parentId?: string | null | undefined;
  /**
   * The author's role on your site, from your own session data. `administrator`
   * makes Akismet treat the content as ham, so never derive it from the request.
   */
  userRole?: string | null | undefined;
  recheckReason?: string | null | undefined;
  honeypotFieldName?: string | null | undefined;
  honeypotFieldValue?: string | null | undefined;
  /** Tags or categories for the content. Sent on checks only, not on feedback. */
  context?: string | readonly string[] | null | undefined;
  callback?: string | null | undefined;
  /** Ask Akismet to classify toxic content. The answer is in `CheckResult.classification`. */
  classify?: boolean | undefined;
  /**
   * Extra request metadata under CGI names (`HTTP_ACCEPT_LANGUAGE`). A reserved Akismet
   * field name, or the honeypot field name, throws `ValidationError`.
   */
  serverVariables?: Record<string, string> | undefined;
}

export type ContentFormValue = string | readonly string[];
export type ContentFormData = Record<string, ContentFormValue>;

/** Which endpoint the encoding is for; feedback omits the check-only fields. */
export type ContentPurpose = 'check' | 'feedback';

export function nullIfEmpty(value: string | null | undefined): string | null {
  return value === null || value === undefined || value === '' ? null : value;
}

function normalizeList(
  value: string | readonly string[] | null | undefined
): string | readonly string[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value === '' ? null : value;
  }
  const filtered = value.filter((v): v is string => typeof v === 'string' && v !== '');
  return filtered.length > 0 ? filtered : null;
}

// A zone-less date-time would be read as the host's local time, so a string must say its zone.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

/**
 * ISO 8601 in UTC with a `Z` suffix and no milliseconds, independent of the host's
 * time zone. The server accepts offsets too, but a UTC wire value cannot be misread.
 */
function formatIso8601(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string' && ISO_DATE_TIME.test(value)) {
    date = new Date(value);
  } else {
    throw invalidValue(field, 'must be a Date or an ISO 8601 date-time string with a zone');
  }
  if (Number.isNaN(date.getTime())) {
    throw invalidValue(field, 'is not a valid date');
  }
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Reject anything the server would misread or that could change the verdict in a
 * way the caller did not intend. Runs before every request; `contentFromRequest` runs
 * it too, so request-derived fields fail where they are built.
 */
export function validateContent(content: Content): void {
  validateValueTypes(content);
  validateIp(content.userIp, 'userIp');
  formatIso8601(content.createdAt, 'createdAt');
  formatIso8601(content.postModifiedAt, 'postModifiedAt');

  // Author fields are what the author typed. A malformed email or URL is a spam signal
  // for Akismet to judge, so they pass through unvalidated.
  for (const field of ['permalink', 'callback'] as const) {
    const url = nullIfEmpty(content[field]);
    if (url !== null) {
      validateUrl(url, field);
    }
  }

  // A database row may store a missing honeypot as empty strings, so empty means absent.
  const honeypotName = nullIfEmpty(content.honeypotFieldName);
  if (nullIfEmpty(content.honeypotFieldValue) !== null && honeypotName === null) {
    throw invalidValue('honeypotFieldValue', 'requires honeypotFieldName to be set');
  }
  if (honeypotName !== null) {
    if (!WIRE_KEY_PATTERN.test(honeypotName)) {
      throw invalidValue('honeypotFieldName', WIRE_KEY_RULE);
    }
    if (PROTOTYPE_NAMES.has(honeypotName)) {
      throw invalidValue('honeypotFieldName', 'cannot be a prototype property name');
    }
    if (RESERVED_KEYS.has(honeypotName) || isServerReadName(honeypotName)) {
      throw invalidValue('honeypotFieldName', 'cannot use a reserved Akismet field name');
    }
  }

  for (const key of Object.keys(content.serverVariables ?? {})) {
    if (!WIRE_KEY_PATTERN.test(key)) {
      throw invalidValue('serverVariables', `key ${JSON.stringify(key)} ${WIRE_KEY_RULE}`);
    }
    if (RESERVED_KEYS.has(key)) {
      throw invalidValue(
        'serverVariables',
        `key ${JSON.stringify(key)} cannot use a reserved Akismet field name`
      );
    }
    if (key === honeypotName) {
      throw invalidValue(
        'serverVariables',
        `key ${JSON.stringify(key)} is the honeypot field name`
      );
    }
  }
}

/**
 * Validate and encode content as Akismet form fields. Feedback carries the original
 * content without the check-only fields `classify` and `comment_context`, which the
 * server reads only on comment-check. `callback` goes on both: feedback queues a webhook too.
 */
export function encodeContent(content: Content, purpose: ContentPurpose): ContentFormData {
  validateContent(content);

  const data: ContentFormData = { user_ip: normalizeIp(content.userIp) };
  const set = (key: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined) {
      data[key] = value;
    }
  };

  set('user_agent', content.userAgent);
  const languages = normalizeList(content.siteLanguages);
  set('blog_lang', typeof languages === 'string' ? languages : languages?.join(', '));
  // URLSearchParams always encodes the body as UTF-8.
  // eslint-disable-next-line unicorn/text-encoding-identifier-case -- wire charset name, as WordPress sends it
  data.blog_charset = 'UTF-8';
  set('comment_content', content.body);
  set('comment_author', content.authorName);
  set('comment_author_email', nullIfEmpty(content.authorEmail));
  set('comment_author_url', nullIfEmpty(content.authorUrl));
  set('comment_type', content.type);
  set('permalink', nullIfEmpty(content.permalink));
  set('referrer', content.referrer);
  set('comment_date_gmt', formatIso8601(content.createdAt, 'createdAt'));
  set('comment_post_modified_gmt', formatIso8601(content.postModifiedAt, 'postModifiedAt'));
  set('comment_parent', content.parentId);
  set('user_role', content.userRole);
  set('recheck_reason', content.recheckReason);

  const honeypotName = nullIfEmpty(content.honeypotFieldName);
  if (honeypotName !== null) {
    data.honeypot_field_name = honeypotName;
    set(honeypotName, content.honeypotFieldValue);
  }

  if (purpose === 'check') {
    const context = normalizeList(content.context);
    if (typeof context === 'string') {
      data.comment_context = context;
    } else if (context !== null) {
      data['comment_context[]'] = [...context];
    }
    if (content.classify === true) {
      data.classify = '1';
    }
  }

  set('callback', nullIfEmpty(content.callback));

  // validateContent() rejected reserved keys and the honeypot name.
  for (const [key, value] of Object.entries(content.serverVariables ?? {})) {
    data[key] = value;
  }

  return data;
}

/** Expand array-valued fields into repeated entries for `URLSearchParams`. */
export function formDataEntries(data: ContentFormData): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      entries.push([key, value]);
    } else {
      for (const item of value) {
        entries.push([key, item]);
      }
    }
  }
  return entries;
}
