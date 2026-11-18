# AGENTS.md

Project-specific guidance for AI agents. Keep this file focused on repo-specific implementation rules; human-facing setup and contribution flow belong in `README.md` and `CONTRIBUTING.md`.

## What this is

`@automattic/akismet` is a TypeScript SDK for the Akismet spam-protection API. It publishes an ESM-only package for Node.js 22+ and intentionally follows JS conventions on the public surface even when the wire format is PHP-flavored. Domain vocabulary lives in `GLOSSARY.md`. Read it before changing behavior.

## Repository shape

```text
src/
  akismet.ts          Main client and public endpoint methods
  content.ts          Request model plus wire serializer
  content-factory.ts  Helpers that build Content from Web/Node requests or plain objects
  dto/                Result types (plain-object interfaces) and their internal parsers
  errors/             SDK error classes; all extend AkismetError
  honeypot.ts         Reads the honeypot field pair from a submitted form
  http-client.ts      Internal transport, timeout, abort, and retry behavior
  index.ts            Public barrel; if it is not re-exported here, it is internal
  ip.ts               Runtime-neutral IP parsing; never import node:net in src/
  redact.ts           API-key redaction for error messages and cause chains
test/                 Vitest tests; import from ../src/index.js (test/wire.ts builds mock clients and reads the sent form body)
test/live/            Live API contract tests in test mode (`npm run test:live`); excluded from `npm test`
examples/             Not a package: typechecked servers per framework
SKILL.md              Consumer-facing guide for AI agents; ships in the tarball (package.json "files")
```

## Public surface rules

- Prefer options objects for public APIs instead of positional argument lists.
- Public types use camelCase names and fields. Keep PHP-style wire keys inside serializers and parsers.
- Every optional public field is `?: T | undefined`, so callers can pass a maybe-missing value under `exactOptionalPropertyTypes`. The exception is per-call `apiKey` and `site`, which stay `?: string` so a missing tenant key fails to compile instead of falling back to the client's. Add `null` only where the usual source returns it (`Headers.get()`, a database row). Read options with `??` or `!= null`; never write `options.x ?? null`. Per-call `apiKey` and `site` are the exception again: `Akismet.context()` checks `key in options`, so a key passed as `undefined` throws instead of falling back.
- `src/index.ts` defines the supported public surface. `configuration.ts` and `http-client.ts` are internal and should stay that way.
- Tests should import from `../src/index.js`, not deep paths, so export regressions are caught.
- Export only what a caller uses: the client, its option and result types, the enums, the errors, `contentFromRequest`, `SDK_VERSION`, and the types those need. Validators, wire constants, and parsers stay internal.

## Data-model rules

- `Content` is the request model and a plain object (an interface, not a class). `encodeContent()` in `src/content.ts` validates and encodes it for the wire and is internal; nothing public exposes the form encoding. Builders return the same plain object so callers can spread over it.
- Every public method takes a `RequestOptions` object as its last argument (`signal`, `timeoutMs`, `isTest`, `apiKey`, `site`). `Akismet.context()` resolves it against the client defaults; thread the resulting `RequestContext` through every helper so redaction uses the key actually sent.
- Results are plain readonly objects described by interfaces in `src/dto/`, built by internal `parseX()` functions. No classes, `fromX` factories, or methods on the public surface, so a result survives `JSON.stringify`. Keep a derived field (`isSpam`, `remaining`) only when it encodes domain knowledge the caller cannot see; do not add one that restates another field.
- Parse strictly only what drives a caller's decision: the JSON shape, the check verdict, the verify-key answer, usage `limit`/`usage`/`throttled`, stats totals, key-sites pagination and site identity, and fixed success bodies. Throw `unexpectedResponse(...)` for those. Informational fields read as `null` when malformed, so a server change cannot break the call.
- Do not add `toArray()` or other PHP-style serializers to results or to `Content`.
- Keep wire encoding details localized. For example, array fields are sent as repeated PHP-style form keys such as `comment_context[]`.

## Error and transport rules

- All SDK-thrown errors extend the abstract `AkismetError` base class. Class names end in `Error`, not `Exception`. Constructors stay public so callers can throw them in tests; the SDK builds its own messages with the internal functions in `src/errors/factories.ts`, never static methods.
- `HttpClient` owns fetch, timeout, abort-signal, and retry behavior.
- Only idempotent operations may use `postIdempotent()`. Side-effecting operations must use `postOnce()`.
- Retries are only for retryable pre-response network failures. Do not add retries for 5xxs, timeouts, or mid-stream failures. The API never sends 429 or `Retry-After`.
- Errors are classified from the response body and `X-akismet-*` headers in `Akismet.rejectIfError()`, not from HTTP status; the API answers 200 for every application error. HTTP status is a fallback for 405 and proxies. Every response-derived error extends `ResponseError` and carries `status`, `headers`, `debugHelp`, and `alert`.
- Endpoint quirks are facts about the backend, not the spec: `get-key-stats` and `deactivate` read only the legacy `key` field; everything else gets `api_key` only. When encoding one, describe the behavior in a comment; never cite backend file paths, because the backend is private and this repo is public.
- Let typed errors propagate. Avoid broad catch-and-wrap patterns that erase error meaning.
- Every error must be safe to log in full. Pass error bodies, debug headers, and caught exceptions through `redactSecret()` / `sanitizeCause()` in `src/redact.ts` before they reach a message or `cause`. Never attach a raw fetch error as `cause`. Never alter successful response bodies.

## Trust-boundary rules

- Request builders trust the connecting peer by default. Forwarding headers are read only when the caller sets `trustedProxyHops`, and only `X-Forwarded-For`, walked right to left. Do not add vendor single-IP headers; callers pass `clientIp` for those.
- Builders forward no request headers unless allowlisted in `forwardHeaders`, and send them under CGI names (`HTTP_*`), which is what the server reads.
- `userRole` and anything else that changes Akismet's verdict comes from caller options, never from request data.
- Any name that becomes a wire key (honeypot field, server variable) must match `WIRE_KEY_PATTERN` (letters, digits, `_`, `-`) and must not be in `RESERVED_KEYS`. The server parses the form with PHP's `$_POST`, which rewrites `.`, spaces, and brackets and truncates at NUL; the allowlist makes every such rewrite impossible rather than enumerating them. Add any new verdict-changing server field to `RESERVED_KEYS`.
- Parser errors are re-thrown through `Akismet.parse()` so a server value echoed in a message is redacted; keep every `parseX()` call that can throw inside it.
- Redact before truncating or otherwise shortening any string that may contain server data. Truncating first can leave a prefix of the key that exact-match redaction no longer recognizes. `safeDiagnostic()` in `src/redact.ts` is the one place that does both. Error constructors do not redact, so pass their message through it first.
- Core must stay runtime-neutral: no `node:*` imports in `src/`, not even `import type`. The published typings must compile without `@types/node` (`npm run check:edge-types`), so describe a Node object by the fields the SDK reads, as `NodeRequestLike` does.

## TypeScript and linting

- The repo uses strict TypeScript, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Filenames are kebab-case.
- Import ordering is linted and usually auto-fixable; do not spend time hand-sorting unless the linter still wants changes.

## When changing behavior

- Add a Vitest test only when it fails if a behavior breaks: happy paths, validation branches, and error mapping. Before you delete a test, break the line in `src/` it guards and confirm another test goes red.
- Re-export any new public API from `src/index.ts`.
- Update `README.md` when the public API or user-facing behavior changes, and `SKILL.md` when a rule an integrator must follow changes. Every rule marked **(SDK)** in `SKILL.md` must correspond to a type or a test; do not mark advice the SDK does not enforce.
- Framework adapters are examples, not package code. Add new ones under `examples/src/` against the real framework; `npm run typecheck` compiles them against `src/` via `paths`, so they cannot drift.
- Every code sample in `README.md`, `SKILL.md`, and `SECURITY.md` must be safe when pasted as-is. Topology-dependent options such as `trustedProxyHops` appear only in a passage that states the deployment they assume; a baseline snippet trusts the socket. Readers copy the first snippet they see.
- Example defaults must be correct for the documented run command, not for an imagined deployment. The README runs them with `curl` against a bare Node process, so `trustedProxyHops` defaults to `0`; a deployment-shaped default would let a direct client forge its IP. Async `node:http` listeners must catch everything, including the body read, because Node does not await them.
- Add a changeset for consumer-visible changes.
- Run the usual checks:
  - `npm test`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run format:check`
  - `npm run check:package` when changing package surface, build config, or exports

## What not to do

- Do not expose internal plumbing such as `HttpClient` or the option normalizers in `configuration.ts`.
- Do not expose PHP-isms on the public surface when a JS-native shape is possible.
- Do not loosen the strict fields listed above, or make an informational field throw.
- Do not route non-idempotent endpoints through retryable code paths.
- Do not change the supported Node.js engine range casually; it is part of the published contract.
