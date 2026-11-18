# Examples

Complete, typechecked examples. `npm run typecheck` at the repo root compiles every file here against the SDK source, so they cannot drift from the API.

| File                                                 | Shows                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`src/express-server.ts`](src/express-server.ts)     | Express 5 comment endpoint; a middleware binds `req.akismet` to each request                  |
| [`src/fastify-server.ts`](src/fastify-server.ts)     | Fastify 5 endpoint; a `preHandler` hook binds `request.akismet` using `request.raw`           |
| [`src/hono-server.ts`](src/hono-server.ts)           | Hono on Node; binds the request with the peer address from the Node adapter                   |
| [`src/node-http-server.ts`](src/node-http-server.ts) | Raw `node:http`, no framework; shows safe handling of a client that disconnects               |
| [`src/nextjs/route.ts`](src/nextjs/route.ts)         | Next.js App Router route handler on a Web `Request`, behind the platform ingress              |
| [`src/nextjs/actions.ts`](src/nextjs/actions.ts)     | Next.js Server Action on bare `headers()`, behind the platform ingress                        |
| [`src/moderation.ts`](src/moderation.ts)             | Moderation action that files feedback from stored content when a moderator corrects a verdict |

Every server reads `AKISMET_API_KEY` and `AKISMET_SITE` from the environment and runs in test mode, so nothing you post trains the classifier:

```bash
npm install            # at the repo root; the example frameworks are dev dependencies
npm run build          # the examples run against dist/
AKISMET_API_KEY=… AKISMET_SITE=https://example.com npx tsx examples/src/express-server.ts
curl -d 'comment=hello&name=Al&email=akismet-guaranteed-spam@example.com' localhost:3000/comments
```

The guaranteed-spam address is always spam in test mode. Use it to see the spam branch, and any other address to see the ham branch.

The examples trust only the connecting socket, because the commands above connect straight to Node. When you put a load balancer in front, set `TRUSTED_PROXY_HOPS` to the number of proxies you run. [Client IP](../README.md#client-ip) in the README explains what goes wrong when the count is off.

The Next.js examples are the exception. They have no socket and run only behind the platform ingress, so they hard-code one hop and cannot be exercised with `curl` against a bare process.

Every example bounds the request body before it is parsed, because an unbounded upload exhausts memory before the SDK ever sees the content. Express (100 KiB) and Fastify (1 MiB) do this by default. Hono does not, so its example registers `bodyLimit`. The raw `node:http` example counts bytes itself. The Next.js examples rely on the ingress in front of them. When you add an example, check its framework's default body limit.
