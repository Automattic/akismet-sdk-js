// Express 5 comment endpoint with Akismet.
// Run: AKISMET_API_KEY=… AKISMET_SITE=https://example.com npx tsx examples/src/express-server.ts
import { AkismetError, type BoundClient, ContentType, ValidationError } from '@automattic/akismet';
import express from 'express';
import { akismet, statusFor, TRUSTED_PROXY_HOPS } from './akismet.js';

declare module 'express-serve-static-core' {
  interface Request {
    akismet: BoundClient;
  }
}

const app = express();
app.use(express.urlencoded({ extended: false }));
// After the body parser, so the honeypot can be read from the parsed form.
app.use((req, _res, next) => {
  req.akismet = akismet.forRequest(req, {
    trustedProxyHops: TRUSTED_PROXY_HOPS,
    form: req.body as Record<string, unknown> | undefined,
  });
  next();
});

app.post('/comments', async (req, res) => {
  // Express 5 leaves req.body undefined when no parser matched, such as a JSON post.
  const form = (req.body ?? {}) as Record<string, unknown>;
  const text = (name: string): string | null =>
    typeof form[name] === 'string' ? form[name] : null;

  try {
    // The request supplies the IP, user agent, and referrer; the form supplies the rest.
    const content = req.akismet.content({
      body: text('comment'),
      authorName: text('name'),
      authorEmail: text('email'),
      authorUrl: text('website'),
      permalink: 'https://example.com/posts/42',
      type: ContentType.Comment,
      // userRole: req.session?.user.role  ← from your session, never from the form
    });

    const result = await akismet.check(content);
    // Store `content` and `result.verdict` with the comment; feedback needs both. See moderation.ts.
    const { status, body } = statusFor(result);
    res.status(status).json(body);
  } catch (e) {
    if (e instanceof ValidationError) {
      res.status(400).json({ error: 'Invalid submission' });
      return;
    }
    if (e instanceof AkismetError) {
      console.error(e); // safe to log: the key is redacted
      res.status(200).json({ status: 'pending-review' }); // fail open into moderation
      return;
    }
    throw e;
  }
});

app.listen(3000, () => {
  console.log('Express example listening on http://localhost:3000/comments');
});
