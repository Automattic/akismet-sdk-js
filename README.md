# Akismet JavaScript SDK

The official server-side JavaScript client for the [Akismet](https://akismet.com/) spam-protection API. Ask Akismet whether a comment, signup, or contact-form submission is spam, and tell it when it was wrong.

- Plain-object requests, typed results, and typed errors.
- Node.js 22+ and edge runtimes with standard `fetch`.
- Safe defaults. A client cannot forge its IP, the SDK forwards only the request headers you allowlist, and every error is safe to log.

Building with an AI agent? Point it at [`SKILL.md`](SKILL.md), which ships inside the package.

## Install

```bash
npm install @automattic/akismet
```

Node.js 22 or later. ESM only; CommonJS projects on Node 22.12+ can `require()` it directly.

## Quick start

```ts
import { Akismet, ContentType, SpamVerdict } from '@automattic/akismet';

const akismet = new Akismet({
  apiKey: process.env.AKISMET_API_KEY!,
  site: 'https://your-site.com', // the front page of the site the content was submitted to
});

// `req` is the incoming request; it supplies the author's IP and user agent (see "Client IP").
const result = await akismet.forRequest(req).check({
  body: form.message,
  authorName: form.name,
  authorEmail: form.email,
  type: ContentType.ContactForm,
});

if (result.verdict === SpamVerdict.Discard) {
  // Akismet is sure this is spam. Drop it without a moderation entry.
} else if (result.isSpam) {
  // hold for review
} else {
  // publish
}
```

`check()` takes a `Content` object. The fields are camelCase versions of the [Akismet API parameters](https://akismet.com/developers/detailed-docs/comment-check/); every field except `userIp` is optional, but the more you send, the better the verdict. The SDK validates the content when you call, so a bad IP or URL throws `ValidationError` before anything is sent.

Check content when it is submitted. If `createdAt` is more than five minutes old, or `recheckReason` is set, Akismet treats the check as a recheck.

## Binding to a request

`akismet.forRequest(request, options)` decides which request data to trust, so you do not have to. It takes a Node request (Express, Fastify's `request.raw`, `node:http`), a Web `Request` (Hono, Next.js route handlers, Workers), or bare `Headers` (Next.js Server Actions), and returns a client bound to that request:

- `content(fields)` returns your fields merged over what the request says about the author: IP, user agent, and referrer. Store it if you moderate, because feedback replays it.
- `check(fields)` checks the same merged content.

```ts
const bound = akismet.forRequest(req, { form: req.body });
const content = bound.content({ body: req.body.comment, type: ContentType.Comment });
const result = await akismet.check(content);
// Save `content` and `result.verdict` with the comment.
```

The request is read when you call `content` or `check`, so a middleware can bind every request cheaply. The bound client has no feedback methods, because a report must replay the stored content, never the moderator's request.

For a check that runs later, such as in a queue worker, `contentFromRequest(request, options)` returns the same request fields without binding a client. Together, `forRequest` and `contentFromRequest` are the request builders.

### Client IP

By default the author's IP is the connecting peer, and the SDK ignores forwarding headers, so a client cannot forge its IP. Behind reverse proxies you control, declare how many there are with `trustedProxyHops` and the SDK walks `X-Forwarded-For` right to left past them. Take the count from your deployment config: too few hops silently reports every author as one of your proxies, and too many lets a client forge the header. Log the `userIp` once in development; a private-range address means the count is too low.

A Web `Request` or bare `Headers` has no socket, so say where the IP comes from:

```ts
import { getConnInfo } from '@hono/node-server/conninfo';

// Hono on Node with no proxy in front. The adapter knows the peer address.
const honoBound = akismet.forRequest(c.req.raw, {
  remoteAddress: getConnInfo(c).remote.address,
});

// Vercel, Workers, or another managed ingress: the ingress is the one proxy
// between the client and your code. Only on such a platform.
const edgeBound = akismet.forRequest(request, { trustedProxyHops: 1 });

// An ingress header you know is authoritative: resolve the IP yourself.
const cfBound = akismet.forRequest(request, { clientIp: request.headers.get('cf-connecting-ip') });
```

Without `remoteAddress`, `clientIp`, or `trustedProxyHops`, a socketless request throws instead of guessing.

### Extra server variables

By default the SDK forwards only the user agent and referrer. Opt in per header. The SDK sends each one under its CGI name, which is what Akismet reads:

```ts
akismet.forRequest(req, {
  forwardHeaders: ['accept-language', 'accept'], // → HTTP_ACCEPT_LANGUAGE, HTTP_ACCEPT
});
```

### Honeypot

Render a hidden field, plus a field named `akismet_honeypot_name` carrying its name. The WordPress plugin randomizes the honeypot's name on each render, so the second field tells Akismet which one to look at. Pass the parsed form as `form`, and the SDK reads both:

```ts
const formBound = akismet.forRequest(req, { form: req.body });
```

A honeypot name the server reads for itself, such as a reserved Akismet field or an `HTTP_*` name, throws `ValidationError`. If your form uses a different name field, set `honeypotNameField`.

### The author's role

`userRole: 'administrator'` makes Akismet treat the content as ham. Set it from your own session data. The request builders never read it from the request, and a honeypot or server variable cannot use the name `user_role`.

## Per-call options

Every method takes an options object as its last argument. Each field you leave out defaults to what you gave the constructor. An `apiKey` or `site` you pass as `undefined` or `null` throws `ValidationError` instead, so a tenant with a missing key is never counted against your own subscription:

```ts
await akismet.check(content, {
  signal: request.signal, // give up when the user disconnects
  timeoutMs: 3_000,
  apiKey: tenant.akismetKey, // one client, many subscriptions
  site: tenant.url,
  isTest: process.env.AKISMET_TEST_MODE === '1', // opt in; unset means live
});
```

## Feedback

When a moderator corrects Akismet, send the content exactly as it was checked, plus the verdict Akismet gave and who is correcting it:

```ts
// At check time: row.content = JSON.stringify(content); row.verdict = result.verdict;
await akismet.submitSpam(JSON.parse(row.content), {
  previousVerdict: row.verdict,
  reporter: moderator.username, // never the author
});
```

Store the `Content` you sent and the verdict you got back at check time. Never rebuild the content from the moderator's request, because the author's IP, user agent, and identity must be the ones Akismet originally saw. Store every submission you hold for review, because you cannot report content you dropped.

Report mistakes promptly. Akismet ignores feedback for content whose `createdAt` is more than 10 days old. Restrict the endpoint that sends feedback to your moderators, because anyone who can call it can train Akismet for your site.

## Errors

All thrown errors extend `AkismetError`. The Akismet API answers HTTP 200 for almost everything, including failures, and signals the cause in the body and `X-akismet-*` headers. The SDK maps those signals to typed errors:

| Error                  | When                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InvalidApiKeyError`   | The key is unknown, empty, or malformed. `debugHelp` says which when the server tells us.                                                                  |
| `SuspendedKeyError`    | Akismet has disabled the key. Checks return no verdict until the account is restored.                                                                      |
| `ThrottledError`       | The subscription's monthly limit has been exceeded for too long and checks are refused. Not a per-second rate limit.                                       |
| `RequestRejectedError` | The server refused the request for another reason: malformed `blog`, a site the key is not authorized for, a bad `hash`.                                   |
| `ValidationError`      | The SDK rejected your input before sending anything.                                                                                                       |
| `NetworkError`         | Transport failure or timeout. `retryable` is true when no response arrived and the call did not time out; the server may still have processed the request. |
| `ServerError`          | A 5xx, or a 200 whose body the SDK cannot interpret.                                                                                                       |
| `ClientError`          | A 4xx. The API itself sends only 405; anything else comes from a proxy.                                                                                    |

Everything except `ValidationError` and `NetworkError` extends `ResponseError`, which exposes `status`, `headers`, `debugHelp`, and `alert` (the account alert, with its `code`, `message`, and any `upgrade` link).

`verifyKey()` and `getStats()` throw `SuspendedKeyError` for a suspended key only when the server sends alert code 10009. Otherwise a suspended key is thrown as `InvalidApiKeyError`, with a `debugHelp` that asks you to contact Akismet support.

While checks are throttled, `verifyKey()`, `getUsageLimit()`, and `getKeySites()` still work, so you can monitor usage.

Every error is safe to log in full. The API key is redacted from messages, error-page bodies, headers, and the whole `cause` chain before an error is thrown.

Decide your failure policy up front. We recommend that you fail open on `NetworkError` and `ServerError` (publish or hold for review, retry the check later) and alert an operator on `ThrottledError`, `SuspendedKeyError`, and `InvalidApiKeyError`.

## Client options

```ts
new Akismet({
  apiKey: '…',
  site: 'https://your-site.com',
  isTest: true, // Akismet will not learn from these calls; see below
  applicationUserAgent: 'MyIntegration/1.0.0', // prepended to the SDK User-Agent
  timeoutMs: 5_000, // default 15 000, covers the whole response
  signal: controller.signal, // client-wide cancellation
  retries: 1, // default 0; see below
  fetch: myFetch, // tests, proxies, custom agents
});
```

**Test mode.** With `isTest`, Akismet learns nothing from the call and skips some of its checks. Use it in development and automated tests, never in production. For a known spam verdict, send `akismet-guaranteed-spam@example.com` as the author email.

**Timeouts and cancellation.** Timeouts throw `NetworkError`. When your signal aborts a call, the SDK rethrows your abort reason unchanged. That is the value passed to `abort()`. Some adapters, such as `@hono/node-server`, abort with a string, so do not assume it is an `Error`.

**Retries.** Off by default. When on, they apply only to idempotent operations (`verifyKey`, `check`, `getSubscription`, `getStats`, `getUsageLimit`, `getKeySites`, `getAccessToken`) and only to network errors where no response arrived. A timeout is not retried, because the attempt already waited the full `timeoutMs`. The server may still have processed the first attempt, so a retried check can count twice. Feedback, revoke, and deactivate calls are never retried, because a replay after the server received the request would duplicate the side effect. The API never sends 429 or `Retry-After`.

**Testing your integration.** Pass a `fetch` that returns canned responses instead of calling the API. The API answers HTTP 200 with a body string, such as `true` or `false` for a check:

```ts
const spamAlways = new Akismet({
  apiKey: 'zzzzzzzzzzzz',
  site: 'https://example.com',
  fetch: () =>
    Promise.resolve(new Response('true', { headers: { 'X-akismet-pro-tip': 'discard' } })),
});
```

## API surface

| Method                                                           | Purpose                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `verifyKey()`                                                    | Confirm the key is valid for the site; returns any account alert.                                       |
| `forRequest(request, options)`                                   | Bind `check(fields)` and `content(fields)` to an incoming request.                                      |
| `check(content)`                                                 | Get a verdict: `verdict`, `isSpam`, `recheckAfter`, `alert`.                                            |
| `submitSpam(content, { previousVerdict, reporter })`             | Report missed spam.                                                                                     |
| `submitHam(content, { previousVerdict, reporter })`              | Report a false positive.                                                                                |
| `getUsageLimit({ extended })`                                    | Monthly usage, limit, throttling, and upgrade hint.                                                     |
| `getSubscription()`                                              | Plan and billing status.                                                                                |
| `getStats({ interval })`                                         | Spam and ham counts over time. Daily 60-day stats need a paid key.                                      |
| `getKeySites({ month, filter, limit, offset, order, extended })` | Sites using this key in a month, paginated. Pass `nextOffset` and the page's `month` for the next page. |
| `revokeSite(hash)` / `unrevokeSite(hash)`                        | Remove or restore a site's permission to use the key.                                                   |
| `deactivate()`                                                   | Tell Akismet the key is no longer used on this site.                                                    |
| `getAccessToken()`                                               | Short-lived token for the Akismet stats dashboard.                                                      |

All methods take per-call options as the last argument. The server does not validate the key in `deactivate()` or when it mints an access token, so call `verifyKey()` first when that matters.

Everything else the package exports:

- Helpers: `contentFromRequest`.
- Enums: `ContentType`, `SpamVerdict`, `StatsInterval`, `KeySitesOrder`, `SubscriptionStatus`.
- Result types (plain objects, safe to `JSON.stringify`; `Subscription.nextBillingDate` is a `Date`, so it comes back from `JSON.parse` as an ISO string): `CheckResult`, `KeyVerification`, `Alert`, `AlertUpgrade`, `UsageLimit`, `Subscription`, `Stats`, `StatsBreakdownEntry`, `KeySitesResponse`, `SiteStats`.
- Errors: `AkismetError`, `ResponseError`, and the classes in [Errors](#errors).
- Constants: `SDK_VERSION`.
- Types: `Content`, `RequestOptions`, `AkismetOptions`, `BoundClient`, `FeedbackOptions`, `GetKeySitesOptions`, `GetStatsOptions`, `GetUsageLimitOptions`, `ContentFromRequestOptions`, `RequestSource`, `NodeRequestLike`, `ClientIpOptions`, `FormSource`, `ResponseDetails`, `FetchLike`.

## Support policy

CI tests every version and runtime listed here.

- **Versions:** the SDK follows semantic versioning. Only a major release can break the API, and its changelog entry says how.
- **Node.js:** every release line before its end-of-life date. Today that is 22, 24, and 26 (the Node matrix in [`ci.yml`](.github/workflows/ci.yml)). Node 22 reaches end of life on 2027-04-30. Dropping a line after its end of life is a minor release with a changelog entry. A major release for each drop would mean a new major every year with no API change.
- **TypeScript:** the shipped `dist/index.d.ts` compiles with `skipLibCheck` off on TypeScript 5.9, 6.x, and 7.x (the `types` legs of the runtimes matrix). Dropping a line is a minor release with a changelog entry.
- **Other runtimes:** Bun, Deno, and Cloudflare Workers install the packed tarball and run a smoke test (the other legs of the runtimes matrix). See [`fixtures/`](fixtures/).
- **Browsers:** unsupported. The API key is a secret, so calls belong on a server.

## Examples

Runnable, typechecked servers live in [`examples/`](examples/): Express, Fastify, Hono, raw `node:http`, a Next.js route handler and Server Action, and a moderation action that files feedback. Each one shows the trust-boundary options for its platform.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and conventions, [AGENTS.md](AGENTS.md) for the repo layout and rules, and [GLOSSARY.md](GLOSSARY.md) for the vocabulary.

## Security

Please do **not** file security vulnerabilities as public issues. See [SECURITY.md](SECURITY.md) for how to report one, and for a checklist of the SDK's safe-use rules.

## Code of conduct

This project follows the [Contributor Covenant](CODE-OF-CONDUCT.md).

## Credits

Per-call options, UTC date serialization, the right-to-left `X-Forwarded-For` walk, and the honeypot reader build on [akismet-js](https://github.com/batuhan/akismet-js) by Batuhan Icoz.

## License

[MIT](LICENSE).
