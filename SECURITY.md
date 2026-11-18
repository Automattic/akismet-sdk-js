# Security Policy

## Supported versions

We patch security vulnerabilities in these versions:

| Version            | Supported          |
| ------------------ | ------------------ |
| 1.x (latest minor) | :white_check_mark: |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Email **security@automattic.com** with:

- the vulnerability and what an attacker could do with it
- steps to reproduce it
- your Node.js version, SDK version, and relevant configuration
- a proof of concept and a suggested fix, if you have them

What happens next:

1. We acknowledge the report within 48 hours.
2. We assess its impact and scope, and send updates as we investigate.
3. We release a patch.
4. We credit you in the advisory, unless you prefer to stay anonymous.

## Using the SDK safely

### API key

Never commit your Akismet API key. Load it from an environment variable or a secret manager, keep `.env` and local config files out of git, use a separate key for each environment, and rotate a key as soon as it leaks.

```ts
const akismet = new Akismet({
  apiKey: process.env.AKISMET_API_KEY!, // never a literal key in source code
  site: 'https://example.com',
});
```

### Input validation

`check`, `submitSpam`, `submitHam`, and the request builders validate IP addresses, URLs, and dates. Bad input throws `ValidationError` before anything is sent. Answer it with a generic error that does not say which field failed:

```ts
import { ValidationError } from '@automattic/akismet';

try {
  await akismet.forRequest(req).check({ body: req.body.message, authorEmail: req.body.email });
} catch (e) {
  if (!(e instanceof ValidationError)) {
    throw e;
  }
  // Respond with a generic 400.
}
```

### HTTPS

The SDK always calls `https://rest.akismet.com`. To route requests through a proxy, pass a custom `fetch` that keeps them on TLS.

### Client IP

The author's IP is a primary spam signal, so the SDK trusts only the connecting peer unless you declare trusted proxies. [Client IP](README.md#client-ip) in the README covers `trustedProxyHops`, `clientIp`, and what goes wrong when the hop count is off.

The builders never send a guess. If `X-Forwarded-For` holds fewer entries than the declared hops, or the selected entry is not an IP address, they throw `ValidationError`. An entry with a port, such as `203.0.113.5:4711` or `[2001:db8::1]:443`, is not an IP address. If your ingress writes ports, strip them yourself and pass the result as `clientIp`.

### Other rules in the README

- [Extra server variables](README.md#extra-server-variables): the SDK forwards no request header unless you allowlist it. Never allowlist `cookie`, `authorization`, or API-key headers.
- [The author's role](README.md#the-authors-role): set `userRole` from your own session data, never from the request.
- [Feedback](README.md#feedback): restrict the endpoint that sends feedback to your moderators.
- [Errors](README.md#errors): every error is safe to log in full. Keep error details out of responses to your users.
- [Client options](README.md#client-options): test mode, timeouts, and which calls retry. Never enable `isTest` in production.

## Security updates

- Watch this repository for security advisories (Watch → Custom → Security alerts).
- Run `npm outdated` and `npm audit` regularly.
- Enable Dependabot alerts for your project.

## Bug bounty

Automattic runs a bug bounty program at https://hackerone.com/automattic. Vulnerabilities in this SDK may qualify.

## Resources

- [Akismet privacy policy](https://akismet.com/privacy/)
- [Automattic security](https://automattic.com/security/)
- [OWASP Node.js security cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
