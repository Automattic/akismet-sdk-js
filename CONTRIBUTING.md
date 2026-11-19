# Contributing to the Akismet JavaScript SDK

Thank you for contributing. This guide covers how to develop, test, and submit changes.

## Code of Conduct

Everyone who takes part in this project follows the [Code of Conduct](CODE-OF-CONDUCT.md). Report unacceptable behavior via the [Automattic contact form](https://developer.wordpress.com/contact/?g21-message=Code%20of%20Conduct%20-%20Akismet%20JavaScript%20SDK) with "Code of Conduct" in the message.

## Getting started

### Prerequisites

- Node.js **22.12+** (the package supports 22+; the test runner needs 22.12)
- npm
- Git

### Setup

```bash
git clone https://github.com/Automattic/akismet-sdk-js.git
cd akismet-sdk-js
npm install
npx lefthook install
```

`npx lefthook install` adds a pre-commit hook that runs `lint-staged` (ESLint `--fix` and Prettier) on the files you touch.

### Running tests

```bash
npm test                                          # one shot
npm run test:watch                                # watch mode
npm run test:coverage                             # coverage report
AKISMET_TEST_API_KEY=... npm run test:live        # live API contract tests (test mode)
# AKISMET_TEST_SITE sets the site URL the live suite sends (default https://example.com)
```

### Quality checks

Before opening a PR, run the full sweep:

```bash
npm run typecheck     # tsc over src, tests, and examples (strict + noUncheckedIndexedAccess)
npm run lint          # ESLint
npm run format:check  # Prettier
npm run check:package # publint, @arethetypeswrong/cli, built version, no internal types, typings without @types/node (runs a build first)
```

`npm run format` fixes formatting, and `npx eslint --fix src test examples *.js` fixes lint.

## Architecture

See [AGENTS.md](AGENTS.md) for the repo layout, conventions, and "what not to do" list. All of it applies to human contributors too.

## Coding conventions

### TypeScript

- Strict mode, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Readonly fields on result types; options objects over positional params for anything ≥ 2 params.
- Filenames are kebab-case (enforced by `unicorn/filename-case`).

### Results

- Describe each result as an interface with `readonly` fields, and build it with an internal `parseX(data)` function. Results are plain objects, so `JSON.stringify` works on them as they are.
- Throw `unexpectedResponse(...)` from `src/errors/factories.ts` only for fields that drive a caller's decision; read informational fields as `null` when malformed.
- Do not add methods or `toArray()`.
- Place in `src/dto/`. Re-export the type from `src/index.ts`.

### Errors

- Extend the abstract `AkismetError` base class.
- Class names end in `Error`, not `Exception`.
- Keep constructors public, so callers can throw the errors in their own tests. Build the SDK's own messages with the internal functions in `src/errors/factories.ts`, not static methods.
- Place in `src/errors/`. Re-export from `src/index.ts`.

### Enums

- Use const-object + derived union type, not TypeScript `enum`:
  ```ts
  export const SpamVerdict = { Ham: 'ham', Spam: 'spam', Discard: 'discard' } as const;
  export type SpamVerdict = (typeof SpamVerdict)[keyof typeof SpamVerdict];
  ```
- When an enum value can come back from the wire or from caller storage, add an `isX(value: unknown): value is X` type guard (see `isSpamVerdict()`).

### Documentation

- JSDoc on public API methods when the "why" is non-obvious. Do not narrate the code.
- Update `README.md` for consumer-facing changes.
- Add a changeset (see below) for any behavior or API change.

## Adding a new endpoint

1. Add the method to `Akismet` with an options object if it takes ≥ 2 params
2. Pick `httpClient.postIdempotent()` if the server can safely replay the call, otherwise `postOnce()`
3. Describe the result as an interface in `src/dto/` with an internal `parseX()` function; throw `unexpectedResponse()` only for fields that drive a caller's decision
4. Re-export the result type from `src/index.ts`
5. Add the endpoint to the `ENDPOINTS` table in `test/akismet.test.ts`, then add tests with the `test/wire.ts` helpers. Cover the error bodies and `X-akismet-*` headers the endpoint can return (errors arrive as HTTP 200) and its validation branches. Each test must fail if the behavior it covers breaks
6. Update the API-surface list in `README.md`
7. Add a changeset: `npx changeset`

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning and changelog.

For any consumer-visible change (features, fixes, breaking changes, docs that affect usage), add a changeset:

```bash
npx changeset
```

This prompts for the bump type (patch/minor/major) and a summary. A markdown file lands in `.changeset/`. Commit it with your PR.

On release, `npm run version-packages` runs `changeset version`, which aggregates all pending changesets into `CHANGELOG.md` and bumps `package.json`, then copies the new version into `src/version.ts` and `package-lock.json`.

## Pull requests

- **Title**: imperative mood, under 70 characters. "Add retry option" not "Added retry option".
- **Description**: summary, linked issues, test plan.
- **Commits**: focused and atomic; imperative mood.
- **Size**: keep PRs focused. Big refactors → discuss in an issue first.

### Before submitting

- [ ] All tests pass (`npm test`)
- [ ] No lint/format/type errors (`npm run lint`, `npm run format:check`, `npm run typecheck`)
- [ ] `npm run check:package` passes (publint, attw, built version, no internal types, edge typings)
- [ ] Changeset added if the change is consumer-visible
- [ ] `README.md` updated if public API changed

## Release process

Maintainers only:

1. Merge PRs with pending changesets
2. Open a release PR that runs `npm run version-packages`, and review the generated version bump and `CHANGELOG.md` by hand
3. Check that the package has a trusted publisher on npmjs.com (package settings → **Trusted publisher**). npm expires a new trusted publisher that does not publish within 2 days, so if none is listed, create one no more than 2 days before you merge: GitHub Actions, owner `Automattic`, repository `akismet-sdk-js`, workflow `release.yml`, environment `npm`. Under **Allowed actions**, enable `npm publish`: new publishers allow only `npm stage publish`, and the workflow publishes directly.
4. Merge the release PR. The [Release workflow](.github/workflows/release.yml) runs every CI check on the merged commit first. If they pass, it finds the new version missing from npm, and its `publish` job waits for approval in the `npm` environment. Pushes that do not bump the version skip the job, so nobody is asked to approve.
5. A reviewer on the `npm` environment approves the deployment from the workflow run (**Review deployments**). The person who merged can approve it; the pause makes sure no version bump publishes until someone confirms it. The job then publishes with provenance through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers). The repository stores no npm token.
6. Once the version is on npm, create the GitHub release from its `CHANGELOG.md` entry:

   ```bash
   gh release create vX.Y.Z --title X.Y.Z --notes "..." \
     --target "$(gh pr view <release PR number> --json mergeCommit -q .mergeCommit.oid)"
   ```

   `--target` must be the full SHA of the release PR's merge commit; the API rejects a short one.

## Getting help

- **Issues**: bugs or feature requests on GitHub
- **Security**: see [SECURITY.md](SECURITY.md)

## License

By contributing, you agree your contributions will be licensed under the MIT License, matching the project license.
