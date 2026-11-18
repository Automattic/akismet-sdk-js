# Runtime fixtures

Each fixture installs the packed tarball, not the source tree, and runs `smoke.js` on one runtime: construct `Akismet` with an injected `fetch`, check a canned `true` answer, and catch an `InvalidApiKeyError`. They detect a broken `exports` map, a file missing from `files`, or a Node-only API in `dist/`. They are not part of `npm test`.

`types/` runs no code. It compiles `consumer.ts`, which imports every public export, against the shipped `dist/index.d.ts` with `skipLibCheck: false`, once for each TypeScript line in the CI matrix.

| Fixture    | Runtime                                     | Version from                        |
| ---------- | ------------------------------------------- | ----------------------------------- |
| `node/`    | Node.js, through `import` and `require()`   | `.nvmrc`                            |
| `bun/`     | Bun                                         | `packageManager` field              |
| `deno/`    | Deno, with no permissions granted           | `.dvmrc`                            |
| `workers/` | Cloudflare Workers (`workerd` via wrangler) | `wrangler` in the lockfile          |
| `types/`   | `tsc`, with no `@types/node`                | `typescript` in the `ci.yml` matrix |

Run one locally with the runtime installed:

```sh
npm run build
npm pack && mv automattic-akismet-*.tgz fixtures/akismet.tgz
fixtures/run.sh node  # or bun, deno, workers
TYPESCRIPT=5.9 fixtures/run.sh types
```

CI runs the same script in the `runtimes` job, against the tarball the `package` job uploads.
