import { type ContentFormData, formDataEntries } from './content.js';
import {
  clientErrorFromStatus,
  networkFailure,
  networkMidStream,
  networkTimeout,
  serverErrorFromStatus,
} from './errors/factories.js';
import { NetworkError } from './errors/network-error.js';
import { redactSecret, safeDiagnostic, sanitizeCause } from './redact.js';
import { SDK_VERSION } from './version.js';

const API_BASE_URL = 'https://rest.akismet.com';

// Distinct from the PHP SDK's `Automattic-Akismet-SDK/`, so the server can tell the two apart.
const SDK_USER_AGENT_PREFIX = 'Automattic-Akismet-SDK-JS/';

/** Delay between retry attempts when `retries` is set. */
const RETRY_BACKOFF_MS = 500;

export type FetchLike = typeof fetch;

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Record<string, string>;
}

/**
 * Per-request values: the client defaults with any per-call overrides already applied.
 * Build it only through the `configuration.ts` normalizers: redaction needs the trimmed
 * key exactly as sent, and URLs assume a site with no trailing slash.
 */
export interface RequestContext {
  readonly apiKey: string;
  readonly site: string;
  readonly isTest: boolean;
  readonly timeoutMs: number;
  /** Caller signals to honour; the client-wide signal and the per-call one. */
  readonly signals: readonly AbortSignal[];
}

function buildUserAgent(applicationUserAgent: string | undefined): string {
  const sdkAgent = `${SDK_USER_AGENT_PREFIX}${SDK_VERSION}`;
  return applicationUserAgent ? `${applicationUserAgent} | ${sdkAgent}` : sdkAgent;
}

function isRetryableNetworkError(e: unknown): boolean {
  return e instanceof NetworkError && e.retryable;
}

/** Wait between retries, but stop with the caller's abort reason as soon as a caller signal fires. */
function delay(ms: number, signals: readonly AbortSignal[]): Promise<void> {
  const signal = AbortSignal.any([...signals]);
  if (signal.aborted) {
    return Promise.reject(signal.reason as Error);
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason as Error);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Lower-cased headers with the key redacted from every value, so they are safe to attach to errors. */
function responseHeadersToRecord(res: Response, apiKey: string): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    const k = name.toLowerCase();
    const safe = redactSecret(value, apiKey);
    const existing = out[k];
    out[k] = existing === undefined ? safe : `${existing}, ${safe}`;
  });
  return out;
}

export interface PostOptions {
  /**
   * Leave out `blog`. The server checks blog against revoked sites and registers it on
   * the key; key-management calls omit it.
   */
  omitSite?: boolean;
}

interface HttpClientOptions {
  /** Extra attempts for idempotent posts after a pre-response network failure. */
  readonly retries: number;
  readonly applicationUserAgent: string | undefined;
  readonly fetch: FetchLike;
}

export class HttpClient {
  private readonly retries: number;
  private readonly userAgent: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: HttpClientOptions) {
    this.retries = options.retries;
    this.userAgent = buildUserAgent(options.applicationUserAgent);
    this.fetchImpl = options.fetch;
  }

  /** POST that retries on pre-response network failure. Server must be able to replay with no side effect. */
  async postIdempotent(
    endpoint: string,
    data: ContentFormData,
    ctx: RequestContext,
    options: PostOptions = {}
  ): Promise<HttpResponse> {
    return this.send(endpoint, this.postInit(data, ctx, options), ctx, true);
  }

  /** POST that is never retried. For side-effecting operations where a replay after partial success would double up. */
  async postOnce(
    endpoint: string,
    data: ContentFormData,
    ctx: RequestContext,
    options: PostOptions = {}
  ): Promise<HttpResponse> {
    return this.send(endpoint, this.postInit(data, ctx, options), ctx, false);
  }

  private postInit(data: ContentFormData, ctx: RequestContext, options: PostOptions): RequestInit {
    const merged: ContentFormData = { ...data, api_key: ctx.apiKey };
    if (options.omitSite !== true) {
      merged.blog = ctx.site;
    }
    if (ctx.isTest) {
      // The server recognises only `1` or `true`.
      merged.is_test = '1';
    }
    const body = new URLSearchParams();
    for (const [key, value] of formDataEntries(merged)) {
      body.append(key, value);
    }
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body: body.toString(),
    };
  }

  private async send(
    endpoint: string,
    init: RequestInit,
    ctx: RequestContext,
    idempotent: boolean
  ): Promise<HttpResponse> {
    const attempts = idempotent ? this.retries + 1 : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.sendOnce(endpoint, init, ctx);
      } catch (e) {
        if (attempt >= attempts || !isRetryableNetworkError(e)) {
          throw e;
        }
        await delay(RETRY_BACKOFF_MS, ctx.signals);
      }
    }
  }

  private async sendOnce(
    endpoint: string,
    init: RequestInit,
    ctx: RequestContext
  ): Promise<HttpResponse> {
    // The abort controller stays active through body consumption below so a
    // server that sends headers then stalls the body still aborts within timeoutMs.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, ctx.timeoutMs);
    const listeners: Array<[AbortSignal, () => void]> = [];
    for (const signal of ctx.signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        break;
      }
      const listener = (): void => {
        controller.abort(signal.reason);
      };
      signal.addEventListener('abort', listener, { once: true });
      listeners.push([signal, listener]);
    }

    try {
      let res: Response;
      try {
        res = await this.fetchImpl(`${API_BASE_URL}${endpoint}`, {
          ...init,
          signal: controller.signal,
        });
      } catch (e) {
        throw classifyFetchError(e, endpoint, ctx, controller, 'pre-response');
      }

      let body: string;
      try {
        body = await res.text();
      } catch (e) {
        throw classifyFetchError(e, endpoint, ctx, controller, 'post-response');
      }

      // The API itself answers 200 for every application error;
      // non-2xx here is a 405 from a wrong method or a proxy in front of the API.
      // Error bodies may be proxy pages that echo the request URL, key included.
      const status = res.status;
      const headers = responseHeadersToRecord(res, ctx.apiKey);
      if (status >= 500) {
        throw serverErrorFromStatus(status, safeDiagnostic(body, ctx.apiKey), { headers });
      }
      if (status >= 400) {
        throw clientErrorFromStatus(status, safeDiagnostic(body, ctx.apiKey), { headers });
      }
      return { status, body, headers };
    } finally {
      clearTimeout(timer);
      for (const [signal, listener] of listeners) {
        signal.removeEventListener('abort', listener);
      }
    }
  }
}

function classifyFetchError(
  e: unknown,
  endpoint: string,
  ctx: RequestContext,
  controller: AbortController,
  phase: 'pre-response' | 'post-response'
): unknown {
  const callerAbort = ctx.signals.find((signal) => signal.aborted);
  if (controller.signal.aborted && callerAbort !== undefined) {
    // Rethrow the caller's own abort reason, not whatever the fetch implementation
    // rejected with: a custom fetch may wrap cancellation in an error that quotes
    // the request URL, key included.
    return callerAbort.reason;
  }
  const cause = sanitizeCause(e, ctx.apiKey);
  if (controller.signal.aborted) {
    return networkTimeout(cause);
  }
  const message = redactSecret(e instanceof Error ? e.message : String(e), ctx.apiKey);
  return phase === 'post-response'
    ? networkMidStream(endpoint, message, cause)
    : networkFailure(endpoint, message, cause);
}
