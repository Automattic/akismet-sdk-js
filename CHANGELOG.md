# @automattic/akismet

## 1.0.1

### Patch Changes

- Published from GitHub Actions through npm trusted publishing, so the package carries a provenance attestation that links it to its source commit. No code changes.

## 1.0.0

First public release of the official server-side JavaScript SDK for the Akismet API. ESM only, MIT. Runs on Node.js 22+ and on edge runtimes with standard `fetch`; the typings need no `@types/node`. The README's support policy lists the Node.js and TypeScript lines CI tests, and the rule for dropping one.

- The client covers every Akismet endpoint: `check`, `submitSpam`/`submitHam`, `verifyKey`, usage limits, subscription, stats, key sites, site revocation, `deactivate`, and the stats access token.
- `akismet.forRequest(request)` binds a check to the incoming request: a Node request, a Web `Request`, or the bare `Headers` a Next.js Server Action gets. `contentFromRequest` builds the same content without a client.
- The client IP comes from the connecting socket by default. `X-Forwarded-For` is read only past a declared `trustedProxyHops`, and no request header is forwarded unless allowlisted, so a client cannot forge its IP.
- `forRequest` reads the honeypot field from the submitted form you pass as `form`.
- Requests and results are plain objects. Store the checked `Content` and its `verdict` as JSON, then replay them in `submitSpam`/`submitHam` with `previousVerdict`.
- Every method takes per-call options (`signal`, `timeoutMs`, `isTest`, `apiKey`, `site`), so one client can serve many subscriptions.
- Errors are typed. The SDK derives them from the response body and `X-akismet-*` alert headers, because the API answers HTTP 200 for failures. `ThrottledError` means checks are refused because the monthly usage limit has been exceeded. Account alerts, and the signal to clear one, come with `check` and `verifyKey` results.
- Informational result fields read as `null` when the server sends an unexpected value, so a change to one cannot break the call.
- The API key never appears in an error, its `cause` chain, or a logged client.
- Retries apply only to idempotent calls, and only when the connection failed before any response. A timeout is never retried. Feedback, revoke, and deactivate calls never retry.
- `SKILL.md` ships in the package as a guide for AI agents integrating the SDK.

Per-call options, UTC date serialization, the right-to-left `X-Forwarded-For` walk, and the honeypot reader build on [akismet-js](https://github.com/batuhan/akismet-js) by Batuhan Icoz.
