// Fastify 5 comment endpoint with Akismet.
// Run: AKISMET_API_KEY=… AKISMET_SITE=https://example.com npx tsx examples/src/fastify-server.ts
import { AkismetError, type BoundClient, ContentType, ValidationError } from '@automattic/akismet';
import Fastify from 'fastify';
import { akismet, statusFor, TRUSTED_PROXY_HOPS } from './akismet.js';

// Fastify logs nothing unless asked; the fail-open branch below depends on this.
const app = Fastify({ logger: true });

// Fastify parses JSON by default; accept classic form posts too.
app.addContentTypeParser(
  'application/x-www-form-urlencoded',
  { parseAs: 'string' },
  (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  }
);

declare module 'fastify' {
  interface FastifyRequest {
    akismet: BoundClient;
  }
}

app.decorateRequest('akismet');
// preHandler runs after body parsing, so the honeypot can be read from the parsed form.
// `request.raw` is the underlying node:http IncomingMessage.
app.addHook('preHandler', (request, _reply, done) => {
  request.akismet = akismet.forRequest(request.raw, {
    trustedProxyHops: TRUSTED_PROXY_HOPS,
    form: request.body as Record<string, unknown> | undefined,
  });
  done();
});

app.post('/comments', async (request, reply) => {
  // A JSON body can carry numbers, arrays, or objects in any field; read strings only.
  const form = (request.body ?? {}) as Record<string, unknown>;
  const text = (name: string): string | null =>
    typeof form[name] === 'string' ? form[name] : null;

  try {
    const content = request.akismet.content({
      body: text('comment'),
      authorName: text('name'),
      authorEmail: text('email'),
      authorUrl: text('website'),
      permalink: 'https://example.com/posts/42',
      type: ContentType.Comment,
    });

    const result = await akismet.check(content);
    const { status, body } = statusFor(result);
    // eslint-disable-next-line @typescript-eslint/return-await -- returning the reply is Fastify's documented async-handler pattern
    return reply.code(status).send(body);
  } catch (e) {
    if (e instanceof ValidationError) {
      return reply.code(400).send({ error: 'Invalid submission' });
    }
    if (e instanceof AkismetError) {
      request.log.error(e); // safe to log: the key is redacted
      return reply.code(200).send({ status: 'pending-review' });
    }
    throw e;
  }
});

await app.listen({ port: 3000 });
console.log('Fastify example listening on http://localhost:3000/comments');
