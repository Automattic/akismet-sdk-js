---
name: akismet
description: Check user-submitted content for spam with the Akismet API using @automattic/akismet, and report misclassifications. Use when adding spam protection to comments, signups, contact forms, or reviews in a Node.js or edge JavaScript application.
---

# Using @automattic/akismet

This file ships inside the npm package so you can read it offline. Statements marked **(SDK)** are enforced by a type or a test in the SDK; the rest are guidance the SDK cannot check for you.

## Setup

```ts
import { Akismet } from '@automattic/akismet';

const akismet = new Akismet({
  apiKey: process.env.AKISMET_API_KEY!,
  site: 'https://your-site.com', // front page of the site the content is submitted to
});
```

The API key is a secret. Read it from the environment on the server. Never put it in client-side code, a browser bundle, or a public repository. The package deliberately has no browser entry point.

Call `await akismet.verifyKey()` once at startup or in a health check. It throws `InvalidApiKeyError` if the key does not work for the site. On success it resolves with any account alert the server sent (`alert`, with `code`, `message`, and any `upgrade` link). Show that alert to an operator, and remove a stored alert when `alertCleared` is true. Treat `InvalidApiKeyError`, `SuspendedKeyError` and `RequestRejectedError` as fatal configuration errors. On `NetworkError` or `ServerError`, log the error and start anyway, because Akismet may be briefly unreachable.

## Checking content

Bind the client to the incoming request, then add your own fields:

```ts
import { ContentType } from '@automattic/akismet';

// Trusts the socket; see "Deployment topology" before adding hops. `form` reads the honeypot.
const content = akismet.forRequest(req, { form: req.body }).content({
  body: req.body.comment,
  authorName: req.body.name,
  authorEmail: req.body.email,
  authorUrl: req.body.website,
  permalink: 'https://your-site.com/posts/42', // the page the comment belongs to
  type: ContentType.Comment,
  userRole: session.user?.role, // from YOUR session, never from the form
});

const result = await akismet.check(content);
```

`forRequest` also takes a Web `Request` (Hono, Next.js route handlers, Workers) or bare `Headers` (Next.js Server Actions). Those have no socket, so they need one of the options below or they throw. A Web `Request` also carries a `signal`; pass it so the check stops when the client disconnects. For Hono on Node with no proxy in front:

```ts
import { getConnInfo } from '@hono/node-server/conninfo';

const result = await akismet
  .forRequest(c.req.raw, {
    remoteAddress: getConnInfo(c).remote.address, // the socket, as the adapter saw it
  })
  .check({ body }, { signal: c.req.raw.signal });
```

### Deployment topology

Count the reverse proxies between the client and this process that you control or that your platform guarantees. The SDK cannot detect this count for you.

| Where the code runs                                    | Pass                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| Node with no proxy in front, Node request              | nothing; the socket is the client                            |
| Node with no proxy in front, Web `Request`             | `{ remoteAddress }` from your adapter; it throws without one |
| Hono on Node with no proxy in front                    | `{ remoteAddress: getConnInfo(c).remote.address }`           |
| Node behind one load balancer you run                  | `{ trustedProxyHops: 1 }`                                    |
| Vercel, Cloudflare Workers, or another managed ingress | `{ trustedProxyHops: 1 }` (the ingress is the proxy)         |
| Platform sets an authoritative header                  | `{ clientIp: request.headers.get('cf-connecting-ip') }`      |

Both mistakes are quiet in production, so take the count from your deployment config:

- **Too few hops** reports every author under one of your proxy addresses. Nothing throws; spam detection loses its primary signal.
- **Too many hops** walks past your proxies into entries the client prepended, so a spammer can forge its IP. It throws only when the chain is shorter than the count.

Check it once in development: log the `userIp` the builder produced. If it is your load balancer's address, or any private-range address, the count is too low.

Rules:

1. **Client IP comes from the socket unless you declare trusted proxies.** (SDK) The request builders read `X-Forwarded-For` only past `trustedProxyHops`. Set `trustedProxyHops` to the number of reverse proxies you operate. Never read `X-Forwarded-For` yourself and pass it as `userIp`, because a client can forge it. If your platform sets an authoritative header such as `CF-Connecting-IP`, pass it as `clientIp`.
2. **By default the SDK forwards only the user agent and referrer.** (SDK) To let Akismet see more, allowlist specific headers with `forwardHeaders: ['accept-language']`. Never allowlist cookies, authorization, or API-key headers. Headers the server reads as the client IP (`x-forwarded-for`, `x-real-ip`, `forwarded`, `cf-connecting-ip`, `true-client-ip`, `akamai-origin-hop`, `x-varnish`) throw `ValidationError`.
3. **`userRole` must come from your session.** (SDK) The request builders never read it from the request. A honeypot or server variable named `user_role` or `user_id` throws `ValidationError`. `administrator` makes Akismet treat the content as ham.
4. **Validation happens at the call.** (SDK) A bad IP, permalink, callback URL, or date throws `ValidationError` before any request is sent. The author's email and URL are sent as typed, because a malformed one is a spam signal. Return a generic 400 to the user, and do not echo the field. A `ValidationError` about an option you set yourself (`remoteAddress`, `trustedProxyHops`, `apiKey`, `site`, `timeoutMs`) is a configuration bug. Log it and fail instead of returning 400.

Act on the result:

```ts
if (result.verdict === SpamVerdict.Discard) {
  // Akismet is sure this is spam. Do not store it or show a moderation entry.
} else if (result.isSpam) {
  // store with status "pending review"
} else {
  // publish
}
if (result.recheckAfter !== null) {
  // schedule another check(content, …) after result.recheckAfter seconds, with recheckReason: 'recheck'
}
```

Store the `content` object (as JSON) and `result.verdict` with the submission. You need both for feedback. Store every submission you hold for review, because you cannot report content you dropped.

## Reporting mistakes

When a moderator marks a published comment as spam, or restores one Akismet held:

```ts
await akismet.submitSpam(JSON.parse(row.content), {
  previousVerdict: row.verdict, // what Akismet said at check time
  reporter: moderator.username, // who is correcting it; never the author
});
// or akismet.submitHam(...)
```

Send the stored content, and never rebuild it from the moderator's request. The author's IP and user agent must be the ones Akismet originally saw. Otherwise the report trains the classifier on the moderator. The SDK never retries feedback, so wrap it in your own job queue if delivery matters.

## Errors

All errors extend `AkismetError` and are safe to log in full; the API key is redacted from every message, header, and cause.

| Error                  | Meaning                                                    | Do                                         |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| `ValidationError`      | Your input was rejected before sending.                    | Generic 400; a bad option is your bug.     |
| `NetworkError`         | Transport failure or timeout.                              | Fail open or hold for review; retry later. |
| `ServerError`          | 5xx or an unreadable response.                             | Same as `NetworkError`.                    |
| `ThrottledError`       | Monthly limit exceeded; checks refused. Not a rate limit.  | Alert an operator; `alert.upgrade.url`.    |
| `SuspendedKeyError`    | Key disabled by Akismet.                                   | Alert an operator.                         |
| `InvalidApiKeyError`   | Key unknown or malformed; see `debugHelp`.                 | Fix configuration.                         |
| `RequestRejectedError` | Server refused: bad `blog`, unauthorized site, bad `hash`. | Fix configuration.                         |
| `ClientError`          | 4xx, only 405 from the API itself.                         | SDK or proxy bug.                          |

Do not sleep and retry on `ThrottledError`. Retrying does not help until the month rolls over or the plan is upgraded.

## Test mode

```ts
new Akismet({ apiKey, site, isTest: true });
// or per call: akismet.check(content, { isTest: true })
```

In test mode Akismet learns nothing and skips some of its checks. Send `akismet-guaranteed-spam@example.com` as `authorEmail` for a known spam verdict. Use test mode in development and in automated tests. Never leave it on in production.

## Multi-tenant hosts

One client can serve many Akismet subscriptions. Pass `apiKey` and `site` per call.

**A missing tenant key never falls back to the client's.** (SDK) A key or site passed as `undefined` or `null` throws `ValidationError`:

```ts
await akismet.check(content, { apiKey: tenant.akismetKey, site: tenant.url });
```

## Things not to do

- Do not use `fetch` against `rest.akismet.com` yourself. The API signals every error with HTTP 200 and a body string; the SDK decodes those for you.
- Do not pass `req.ip` from Express as `userIp` unless you have configured `trust proxy` correctly; prefer the builders.
- Do not catch `AkismetError` and continue silently in production. Log it; the error is safe to log.
