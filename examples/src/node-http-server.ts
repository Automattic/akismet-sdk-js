// Raw node:http comment endpoint with Akismet. No framework.
// Run: AKISMET_API_KEY=… AKISMET_SITE=https://example.com npx tsx examples/src/node-http-server.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AkismetError, ContentType, ValidationError } from '@automattic/akismet';
import { akismet, statusFor, TRUSTED_PROXY_HOPS } from './akismet.js';

/** Frameworks enforce a body limit for you; without one, a client can stream until the process dies. */
const MAX_BODY_BYTES = 64 * 1024;

class PayloadTooLargeError extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    received += buffer.byteLength;
    if (received > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.destroyed) {
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handleComment(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Everything that can fail, including reading the body, happens inside one try: an
  // async request listener's promise is not awaited by node:http, so an unhandled
  // rejection here would take the process down.
  try {
    const form = Object.fromEntries(new URLSearchParams(await readBody(req)));

    const content = akismet
      .forRequest(req, { trustedProxyHops: TRUSTED_PROXY_HOPS, form })
      .content({
        body: form.comment ?? null,
        authorName: form.name ?? null,
        authorEmail: form.email ?? null,
        authorUrl: form.website ?? null,
        permalink: 'https://example.com/posts/42',
        type: ContentType.Comment,
      });

    const result = await akismet.check(content);
    const { status, body } = statusFor(result);
    if (status === 204) {
      res.writeHead(204).end();
      return;
    }
    json(res, status, body);
  } catch (e) {
    if (e instanceof PayloadTooLargeError) {
      // Answer, then drop the connection so the client stops uploading.
      json(res, 413, { error: 'Submission too large' });
      res.destroy();
      return;
    }
    if (e instanceof ValidationError) {
      json(res, 400, { error: 'Invalid submission' });
      return;
    }
    if (e instanceof AkismetError) {
      console.error(e); // safe to log: the key is redacted
      json(res, 200, { status: 'pending-review' });
      return;
    }
    // Client went away mid-upload (ECONNRESET) or something unexpected: never rethrow
    // from the listener. Log and make sure the socket is released.
    console.error(e);
    if (!res.destroyed) {
      res.destroy();
    }
  }
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/comments') {
    res.writeHead(404).end();
    return;
  }
  void handleComment(req, res);
});

server.listen(3000, () => {
  console.log('node:http example listening on http://localhost:3000/comments');
});
