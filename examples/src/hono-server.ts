// Hono comment endpoint with Akismet, served on Node through @hono/node-server. Hono
// hands you a Web Request, so the handler ports to Bun, Deno, and Cloudflare Workers;
// only the peer address changes: take it from that runtime's adapter, or use
// trustedProxyHops behind a platform ingress.
// Run: AKISMET_API_KEY=… AKISMET_SITE=https://example.com npx tsx examples/src/hono-server.ts
import { AkismetError, ContentType, ValidationError } from '@automattic/akismet';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { akismet, statusFor, TRUSTED_PROXY_HOPS } from './akismet.js';

const app = new Hono();

// Hono has no default body limit, unlike Express (100 KiB) and Fastify (1 MiB). Without
// one a client can stream until the process runs out of memory.
const limitBody = bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json({ error: 'Submission too large' }, 413),
});

app.post('/comments', limitBody, async (c) => {
  const form = await c.req.formData();
  // A Web Request has no socket, so take the peer address from the Node adapter.
  const bound = akismet.forRequest(c.req.raw, {
    remoteAddress: getConnInfo(c).remote.address,
    trustedProxyHops: TRUSTED_PROXY_HOPS,
    form,
  });
  const text = (name: string): string | null => {
    const value = form.get(name);
    return typeof value === 'string' ? value : null;
  };

  try {
    const content = bound.content({
      body: text('comment'),
      authorName: text('name'),
      authorEmail: text('email'),
      authorUrl: text('website'),
      permalink: 'https://example.com/posts/42',
      type: ContentType.Comment,
    });

    const result = await akismet.check(content, { signal: c.req.raw.signal });
    const { status, body } = statusFor(result);
    return status === 204 ? c.body(null, 204) : c.json(body, 200);
  } catch (e) {
    if (e instanceof ValidationError) {
      return c.json({ error: 'Invalid submission' }, 400);
    }
    if (e instanceof AkismetError) {
      console.error(e); // safe to log: the key is redacted
      return c.json({ status: 'pending-review' }, 200);
    }
    throw e;
  }
});

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('Hono example listening on http://localhost:3000/comments');
});
