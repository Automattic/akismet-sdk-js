import {
  DEFAULT_TIMEOUT_MS,
  normalizeApiKey,
  normalizeRetries,
  normalizeSite,
  normalizeTimeout,
  normalizeUserAgent,
} from './configuration.js';
import {
  contentFromRequest,
  type ContentFromRequestOptions,
  type RequestSource,
} from './content-factory.js';
import { type Content, encodeContent } from './content.js';
import { alertFromHeaders } from './dto/alert.js';
import { optionalString } from './dto/cast.js';
import { type CheckResult, parseCheckResult } from './dto/check-result.js';
import { type KeySitesResponse, parseKeySitesResponse } from './dto/key-sites-response.js';
import { type KeyVerification, parseKeyVerification } from './dto/key-verification.js';
import { parseStats, type Stats } from './dto/stats.js';
import { parseSubscription, type Subscription } from './dto/subscription.js';
import { parseUsageLimit, type UsageLimit } from './dto/usage-limit.js';
import { isSpamVerdict, type KeySitesOrder, SpamVerdict, StatsInterval } from './enums.js';
import {
  invalidApiKey,
  invalidValue,
  requestRejected,
  suspendedKey,
  throttled,
  unexpectedResponse,
} from './errors/factories.js';
import { InvalidApiKeyError } from './errors/invalid-api-key-error.js';
import type { ResponseDetails } from './errors/response-error.js';
import { ServerError } from './errors/server-error.js';
import {
  HttpClient,
  type FetchLike,
  type HttpResponse,
  type RequestContext,
} from './http-client.js';
import { safeDiagnostic } from './redact.js';

const FEEDBACK_SUCCESS_BODY = 'Thanks for making the web a better place.';
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const TOKEN_PATTERN = /^[A-Za-z0-9+/=_.-]+$/;
/** Alert code for a site this key is not authorized to use (revoked). */
const SITE_NOT_AUTHORIZED_ALERT_CODE = 10_403;
/** Alert code for refused checks: the monthly usage limit has been exceeded for too long. */
const USAGE_LIMIT_ALERT_CODE = 10_508;
/** Alert code for a suspended subscription, sent with `invalid` on key-level endpoints. */
const SUBSCRIPTION_SUSPENDED_ALERT_CODE = 10_009;

function validateHash(hash: string): void {
  // The server reads the hash with PHP empty(), which treats "0" as missing.
  if (hash.trim() === '' || hash === '0') {
    throw invalidValue('hash', 'must be a non-empty site hash');
  }
}

/**
 * Per-call overrides. Each defaults to the value given to the {@link Akismet} constructor.
 * Key and site overrides let one client serve many Akismet subscriptions.
 */
export interface RequestOptions {
  /** Abort this call; merged with the client-wide signal and the timeout. */
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  /**
   * Test mode for this call only: Akismet will not learn from it. Only checks and
   * feedback train Akismet, so on the read-only calls (usage, stats, subscription,
   * key sites) it changes nothing.
   */
  isTest?: boolean | undefined;
  // No `| undefined` on purpose: a tenant key or site that may be missing must not
  // type-check, because an absent one silently falls back to the client's own.
  apiKey?: string;
  /** Front-page URL of the site the content was submitted to. */
  site?: string;
}

export interface FeedbackOptions extends RequestOptions {
  /**
   * The verdict Akismet originally gave for this content, so it can audit itself.
   * Pass the `verdict` you stored at check time, or the whole `CheckResult`.
   */
  previousVerdict?: SpamVerdict | CheckResult | null | undefined;
  /**
   * Who is filing the report, for example a moderator's username. Never the author:
   * the author's identity is already in the content.
   */
  reporter?: string | undefined;
}

export interface GetUsageLimitOptions extends RequestOptions {
  /** Also return the over-limit `noticeLevel` and the recommended `upgrade`. */
  extended?: boolean | undefined;
}

export interface GetStatsOptions extends RequestOptions {
  /** Reporting window. Defaults to the last six months. */
  interval?: StatsInterval | undefined;
}

export interface GetKeySitesOptions extends RequestOptions {
  /** `YYYY-MM` month bucket. */
  month?: string | undefined;
  /** Substring match against site URL. */
  filter?: string | undefined;
  /** Max sites per response. */
  limit?: number | undefined;
  /** Pagination offset. */
  offset?: number | undefined;
  order?: KeySitesOrder | undefined;
  /** Request `hash` and `eligible_for_revoke` fields in each site entry. */
  extended?: boolean | undefined;
}

export interface AkismetOptions {
  apiKey: string;
  site: string;
  isTest?: boolean | undefined;
  applicationUserAgent?: string | undefined;
  /** Per-request timeout in milliseconds. Defaults to 15000 (15s). */
  timeoutMs?: number | undefined;
  /** Client-wide AbortSignal, merged with each call's own signal and timeout. */
  signal?: AbortSignal | undefined;
  /**
   * Extra attempts after a network failure where no response arrived, other than a
   * timeout. Defaults to `0`.
   * Only idempotent calls retry; feedback, revoke, and deactivate never do, because a
   * replay would repeat the side effect. The server may still have
   * processed the first attempt, so a retried check can count twice.
   */
  retries?: number | undefined;
  /** A `fetch` to use instead of the global one, such as a stub in tests. */
  fetch?: FetchLike | undefined;
}

/**
 * A client bound to one incoming request. It has no feedback methods: feedback must replay
 * the content stored at check time, never the request of the moderator reporting it.
 */
export interface BoundClient {
  /**
   * `fields` merged over what the request says about its author; a field given as
   * `undefined` is ignored. Store this for feedback.
   */
  content(fields?: Partial<Content>): Content;
  /** Check `fields`, merged as `content()` merges them. */
  check(fields?: Partial<Content>, options?: RequestOptions): Promise<CheckResult>;
}

/**
 * Only an absent key or site falls back to the client's. A present one is validated even
 * when it is null or undefined, so a tenant with a missing key is never filed under the
 * default subscription. The type alone cannot ensure this: callers without
 * exactOptionalPropertyTypes can pass `apiKey: undefined`.
 */
function override(
  options: RequestOptions,
  key: 'apiKey' | 'site',
  normalize: (value: string) => string,
  fallback: string
): string {
  if (!(key in options)) {
    return fallback;
  }
  const value = options[key];
  if (value == null) {
    throw invalidValue(key, 'was passed as undefined or null; omit it to use the client default');
  }
  return normalize(value);
}

function previousVerdictWire(previous: SpamVerdict | CheckResult): string {
  // A stored verdict comes back from a database, so its type is not a guarantee.
  const verdict: unknown = typeof previous === 'string' ? previous : previous.verdict;
  if (!isSpamVerdict(verdict)) {
    throw invalidValue('previousVerdict', "expected 'ham', 'spam', or 'discard'");
  }
  return verdict === SpamVerdict.Ham ? 'false' : 'true';
}

export class Akismet {
  // ES private fields, not TS `private`: a logged or serialized client must not print the key.
  /** The context a call gets when it overrides nothing. */
  readonly #defaults: RequestContext;
  readonly #httpClient: HttpClient;

  /** Throws `ValidationError` when an option is invalid. */
  constructor(options: AkismetOptions) {
    this.#defaults = {
      apiKey: normalizeApiKey(options.apiKey),
      site: normalizeSite(options.site),
      isTest: options.isTest ?? false,
      timeoutMs: normalizeTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      signals: options.signal ? [options.signal] : [],
    };
    this.#httpClient = new HttpClient({
      retries: normalizeRetries(options.retries ?? 0),
      applicationUserAgent: normalizeUserAgent(options.applicationUserAgent),
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    });
  }

  /**
   * Confirm the key works for the site. Resolves with any account alert the server sent
   * alongside `valid`, such as an approaching usage limit; throws when the key is refused.
   */
  async verifyKey(options: RequestOptions = {}): Promise<KeyVerification> {
    const ctx = this.context(options);
    // `api_key` only: the server prefers a legacy `key` field even when it is empty.
    const response = await this.#httpClient.postIdempotent('/1.1/verify-key', {}, ctx);
    this.rejectIfError(response, ctx);
    if (response.body !== 'valid') {
      throw this.unexpectedResponse(response, ctx);
    }
    return parseKeyVerification(response.headers);
  }

  async check(content: Content, options: RequestOptions = {}): Promise<CheckResult> {
    const ctx = this.context(options);
    const response = await this.#httpClient.postIdempotent(
      '/1.1/comment-check',
      encodeContent(content, 'check'),
      ctx
    );
    this.rejectIfError(response, ctx);
    const { body } = response;
    if (body !== 'true' && body !== 'false') {
      throw this.unexpectedResponse(response, ctx);
    }
    return parseCheckResult(body, response.headers);
  }

  /**
   * Bind checks to an incoming request. The request is read when `check` runs, so a
   * middleware can bind every request and only the routes that check pay for it.
   */
  forRequest(source: RequestSource, options: ContentFromRequestOptions = {}): BoundClient {
    // A field given as undefined, such as `userAgent: headers['user-agent']` when the
    // header is missing, must not erase what the request supplied.
    const content = (fields: Partial<Content> = {}): Content => ({
      ...contentFromRequest(source, options),
      ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
    });
    return {
      content,
      check: async (fields = {}, requestOptions = {}) =>
        this.check(content(fields), requestOptions),
    };
  }

  /** Report content Akismet called ham that was actually spam. */
  async submitSpam(content: Content, options: FeedbackOptions = {}): Promise<void> {
    await this.submitFeedback('/1.1/submit-spam', content, options);
  }

  /** Report content Akismet called spam that was actually ham. */
  async submitHam(content: Content, options: FeedbackOptions = {}): Promise<void> {
    await this.submitFeedback('/1.1/submit-ham', content, options);
  }

  async getUsageLimit(options: GetUsageLimitOptions = {}): Promise<UsageLimit> {
    const ctx = this.context(options);
    const params: Record<string, string> = options.extended === true ? { extended: 'true' } : {};
    const response = await this.#httpClient.postIdempotent('/1.2/usage-limit', params, ctx, {
      omitSite: true,
    });
    const data = this.decodeJsonResponse(response, ctx);
    return this.parse(response, ctx, () => parseUsageLimit(data));
  }

  async getSubscription(options: RequestOptions = {}): Promise<Subscription> {
    const ctx = this.context(options);
    const response = await this.#httpClient.postIdempotent('/1.1/get-subscription', {}, ctx);
    const data = this.decodeJsonResponse(response, ctx);
    return this.parse(response, ctx, () => parseSubscription(data));
  }

  async getStats(options: GetStatsOptions = {}): Promise<Stats> {
    const ctx = this.context(options);
    // get-key-stats reads only the legacy `key` field; `api_key` alone is rejected.
    const response = await this.#httpClient.postIdempotent(
      '/1.2/get-key-stats',
      { key: ctx.apiKey, from: options.interval ?? StatsInterval.SixMonths },
      ctx,
      { omitSite: true }
    );
    const data = this.decodeJsonResponse(response, ctx);
    return this.parse(response, ctx, () => parseStats(data));
  }

  async getKeySites(options: GetKeySitesOptions = {}): Promise<KeySitesResponse> {
    const ctx = this.context(options);
    const month = optionalString(options.month);
    const filter = optionalString(options.filter);
    const order = optionalString(options.order);
    const limit = options.limit ?? 500;
    const offset = options.offset ?? 0;
    if (month !== null && !MONTH_REGEX.test(month)) {
      throw invalidValue('month', 'must be in YYYY-MM format (01-12)');
    }
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw invalidValue('limit', 'must be a positive integer');
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw invalidValue('offset', 'must be a non-negative integer');
    }

    const params: Record<string, string> = {
      limit: String(limit),
      offset: String(offset),
    };
    if (month !== null) {
      params.month = month;
    }
    if (filter !== null) {
      params.filter = filter;
    }
    if (order !== null) {
      params.order = order;
    }
    if (options.extended === true) {
      params.extended = 'true';
    }

    const response = await this.#httpClient.postIdempotent('/1.2/key-sites', params, ctx, {
      omitSite: true,
    });
    const data = this.decodeJsonResponse(response, ctx);
    return this.parse(response, ctx, () => parseKeySitesResponse(data));
  }

  async revokeSite(hash: string, options: RequestOptions = {}): Promise<void> {
    validateHash(hash);
    const ctx = this.context(options);
    const response = await this.#httpClient.postOnce('/1.2/revoke-site', { hash }, ctx, {
      omitSite: true,
    });
    this.expectBody(response, ctx, 'Revoked');
  }

  async unrevokeSite(hash: string, options: RequestOptions = {}): Promise<void> {
    validateHash(hash);
    const ctx = this.context(options);
    const response = await this.#httpClient.postOnce('/1.2/unrevoke-site', { hash }, ctx, {
      omitSite: true,
    });
    this.expectBody(response, ctx, 'Unrevoked');
  }

  /**
   * Tell Akismet this key is no longer in use on the configured site. The server
   * answers `deactivated`, or an empty body when it has no account to deactivate,
   * which also means there is nothing left to do. It does not validate the key, so an
   * unknown key resolves too; call {@link Akismet.verifyKey} first if that matters.
   */
  async deactivate(options: RequestOptions = {}): Promise<void> {
    const ctx = this.context(options);
    // deactivate reads only the legacy `key` field; `api_key` alone is rejected.
    const response = await this.#httpClient.postOnce('/1.1/deactivate', { key: ctx.apiKey }, ctx);
    this.rejectIfError(response, ctx);
    if (response.body !== 'deactivated' && response.body !== '') {
      throw this.unexpectedResponse(response, ctx);
    }
  }

  /**
   * A short-lived token for the Akismet stats dashboard. The server does not validate
   * the key when it mints the token, so call {@link Akismet.verifyKey} first.
   */
  async getAccessToken(options: RequestOptions = {}): Promise<string> {
    const ctx = this.context(options);
    // The server stores nothing when it mints a token, so a replay only mints another.
    const response = await this.#httpClient.postIdempotent('/1.1/token', {}, ctx);
    this.rejectIfError(response, ctx);
    if (response.body === '') {
      throw new InvalidApiKeyError(
        'Failed to exchange API key for access token.',
        this.details(response, ctx)
      );
    }
    // Loose on purpose: base64, base64url, and JWT all pass; a proxy page or a message does not.
    // The body may still hold a real token, so the message never quotes it.
    if (!TOKEN_PATTERN.test(response.body)) {
      throw unexpectedResponse(
        `access token has unexpected characters (${String(response.body.length)} chars)`,
        this.details(response, ctx)
      );
    }
    return response.body;
  }

  /** Resolve per-call overrides against the client defaults, validating the overrides. */
  private context(options: RequestOptions): RequestContext {
    // A positional call ported from another SDK, such as verifyKey('key'), lands here.
    const given: unknown = options;
    if (typeof given !== 'object' || given === null) {
      throw invalidValue('options', 'must be an object');
    }
    const defaults = this.#defaults;
    return {
      apiKey: override(options, 'apiKey', normalizeApiKey, defaults.apiKey),
      site: override(options, 'site', normalizeSite, defaults.site),
      isTest: options.isTest ?? defaults.isTest,
      timeoutMs: normalizeTimeout(options.timeoutMs ?? defaults.timeoutMs),
      signals: options.signal ? [...defaults.signals, options.signal] : defaults.signals,
    };
  }

  /**
   * The API answers HTTP 200 for every application error and signals the cause in
   * the body and `X-akismet-*` headers. Throw the matching typed
   * error, or return when the body is not a known error signal.
   */
  private rejectIfError(response: HttpResponse, ctx: RequestContext): void {
    const { body, headers } = response;

    if (body === 'invalid') {
      const details = this.details(response, ctx);
      const alertCode = details.alert?.code;
      if (alertCode === USAGE_LIMIT_ALERT_CODE) {
        throw throttled(details);
      }
      if (alertCode === SUBSCRIPTION_SUSPENDED_ALERT_CODE) {
        throw suspendedKey(details);
      }
      if (alertCode === SITE_NOT_AUTHORIZED_ALERT_CODE) {
        throw requestRejected(
          details.alert?.message ?? 'this site is not authorized to use the API key',
          details
        );
      }
      throw invalidApiKey(details);
    }
    // Suspended keys: comment-check answers `false` with the error header, feedback answers `Invalid key`.
    if (body === 'Invalid key' || headers['x-akismet-error'] === 'suspended') {
      throw suspendedKey(this.details(response, ctx));
    }
    if (body.startsWith('Missing required field') || body.startsWith('Invalid required field')) {
      throw requestRejected(this.safeDiagnostic(body, ctx), this.details(response, ctx));
    }
  }

  /** For endpoints whose only success is one fixed word; any other body is the server's refusal. */
  private expectBody(response: HttpResponse, ctx: RequestContext, success: string): void {
    this.rejectIfError(response, ctx);
    if (response.body !== success) {
      throw requestRejected(this.safeDiagnostic(response.body, ctx), this.details(response, ctx));
    }
  }

  private details(response: HttpResponse, ctx: RequestContext): ResponseDetails {
    const h = response.headers;
    const debugHelp = optionalString(h['x-akismet-debug-help']);
    const alertMessage = optionalString(h['x-akismet-alert-msg']);
    return {
      status: response.status,
      headers: h,
      debugHelp: debugHelp === null ? null : this.safeDiagnostic(debugHelp, ctx),
      alert: alertFromHeaders(
        h,
        alertMessage === null ? null : this.safeDiagnostic(alertMessage, ctx)
      ),
    };
  }

  /**
   * Feedback describes the original content and author exactly as checked. The
   * reporter and the previous verdict are the only things added, and they come from
   * the caller, never from the current request.
   */
  private async submitFeedback(
    endpoint: string,
    content: Content,
    options: FeedbackOptions
  ): Promise<void> {
    const ctx = this.context(options);
    const data = encodeContent(content, 'feedback');
    if (options.reporter) {
      data.reporter = options.reporter;
    }
    if (options.previousVerdict != null) {
      data.comment_check_response = previousVerdictWire(options.previousVerdict);
    }

    const response = await this.#httpClient.postOnce(endpoint, data, ctx);
    this.rejectIfError(response, ctx);
    if (response.body !== FEEDBACK_SUCCESS_BODY) {
      throw this.unexpectedResponse(response, ctx);
    }
  }

  private decodeJsonResponse(response: HttpResponse, ctx: RequestContext): Record<string, unknown> {
    this.rejectIfError(response, ctx);
    let data: unknown;
    try {
      data = JSON.parse(response.body) as unknown;
    } catch {
      throw this.unexpectedResponse(response, ctx);
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw this.unexpectedResponse(response, ctx);
    }
    return data as Record<string, unknown>;
  }

  /** Error bodies are redacted before they reach a message; successful bodies are never altered. */
  private unexpectedResponse(response: HttpResponse, ctx: RequestContext): ServerError {
    return unexpectedResponse(this.safeDiagnostic(response.body, ctx), this.details(response, ctx));
  }

  /**
   * A parser error may quote a server value. Re-throw the same error class with the
   * message made safe and the response attached; parsed values pass through untouched.
   */
  private parse<T>(response: HttpResponse, ctx: RequestContext, parseResult: () => T): T {
    try {
      return parseResult();
    } catch (e) {
      if (e instanceof ServerError) {
        throw new ServerError(this.safeDiagnostic(e.message, ctx), this.details(response, ctx));
      }
      throw e;
    }
  }

  private safeDiagnostic(text: string, ctx: RequestContext): string {
    return safeDiagnostic(text, ctx.apiKey);
  }
}
