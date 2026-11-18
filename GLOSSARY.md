# Akismet SDK

The JavaScript SDK for the Akismet spam-protection API. It lets server-side JavaScript applications ask Akismet whether user-submitted content is spam, and tell Akismet when it was wrong. They do not need to learn the API's wire format or which request data is safe to trust.

## Language

### Checking content

**Content**:
The user-submitted item being checked, together with the context Akismet uses to judge it: author identity, site, page, and timing.
_Avoid_: Comment (too narrow; content may be a signup, a contact form, or a review), payload, request body

**Content type**:
The kind of thing the content is, such as a comment, a forum post, a signup, or a contact form.

**Check**:
A request asking Akismet whether content is spam. Checks are idempotent and may be retried.
_Avoid_: Verify (reserved for keys), scan, classify

**Verdict**:
Akismet's answer to a check: ham, spam, or discard.
_Avoid_: Result, classification, score

**Discard**:
The verdict for content Akismet is sure is spam. Akismet recommends dropping it without moderation.
_Avoid_: Blatant spam, hard spam

**Ham**:
Content Akismet judges as legitimate.
_Avoid_: Not spam, clean, valid

**Recheck**:
A later check of the same content after Akismet signals that its verdict may change, or after the site changes the content.

**Pro tip**:
A hint attached to a verdict that explains a notable reason for it, such as the content coming from a known spammer.

**Test mode**:
A flag on a check or feedback that tells Akismet not to learn from it. Used for development and automated tests.
_Avoid_: Dry run, sandbox

### Correcting Akismet

**Feedback**:
Telling Akismet that a previous verdict was wrong. Feedback is either a spam report or a ham report. It has side effects and is never retried automatically.
_Avoid_: Training, submission, learning

**Spam report**:
Feedback that content Akismet called ham was actually spam.
_Avoid_: Submit spam, false negative report

**Ham report**:
Feedback that content Akismet called spam was actually ham.
_Avoid_: Submit ham, false positive report

**Previous verdict**:
The verdict Akismet originally gave for content now being reported. Attached to feedback so Akismet can audit itself.

**Reporter**:
The person or system filing feedback, as distinct from the author of the content. Feedback always describes the original author, never the reporter.
_Avoid_: Moderator (one kind of reporter), user

### Identity and trust

**Author**:
The person who submitted the content. Identified by IP address, user agent, name, email, and URL as supplied at submission time.
_Avoid_: User, commenter, visitor

**Client IP**:
The IP address of the author's connection as the application observed it. Deriving it means choosing which request data to trust.
_Avoid_: User IP (the wire name), remote address, X-Forwarded-For

**Trusted proxy hops**:
The number of reverse proxies in front of the application whose forwarding headers the application trusts when it derives the client IP.

**Server variables**:
Request metadata the application chooses to pass to Akismet in addition to the documented author signals. Named after the CGI environment they originate from.
_Avoid_: Headers, environment, meta

**Role**:
The author's privilege level on the site. An administrator role causes Akismet to treat the content as ham, so it must never come from the author's own request.
_Avoid_: User role (the wire name), permission

**Honeypot**:
A hidden form field that humans leave empty and bots fill in. Its name is sent with the check so Akismet can weigh the value.
_Avoid_: Trap field, bot field

### Account and sites

**API key**:
The secret that identifies an Akismet subscription. It must never reach a browser or appear in a logged error.
_Avoid_: Key (the legacy wire name), token

**Site**:
The web property the content was submitted to, identified by its front-page URL.
_Avoid_: Blog (the wire name), domain, host

**Key verification**:
Confirming that an API key is valid for a site before using it.
_Avoid_: Key check, auth

**Key sites**:
The list of sites that have used an API key in a given month, with per-site activity.

**Revocation**:
Removing a site's permission to use an API key. Can be reversed.

**Usage limit**:
The monthly number of checks a subscription allows, and how much of it has been used.
_Avoid_: Quota, plan limit

**Throttling**:
Akismet refusing checks because the usage limit has been exceeded. An alert signals it, and the HTTP status stays 200.
_Avoid_: Rate limiting (implies per-second limits, which Akismet does not expose)

### Signals from Akismet

**Alert**:
An account-level notice Akismet attaches to a response, identified by a numeric alert code and a message. Throttling, upgrade recommendations, and suspension are alerts.

**Alert clearing**:
A signal that an alert shown earlier for the key no longer applies, so the site should remove it.

**Debug help**:
A human-readable explanation Akismet attaches when it rejects a request, saying which field was wrong.

**Suspended key**:
An API key Akismet has disabled. Checks fail with a suspension signal rather than a verdict.
