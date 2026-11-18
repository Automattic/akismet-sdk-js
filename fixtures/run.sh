#!/bin/sh
# Installs fixtures/akismet.tgz (the `npm pack` output) into one runtime's fixture and
# runs its smoke test. CI and local runs use this same script.
set -eu

runtime="${1:-}"
cd "$(dirname "$0")"
if [ ! -f akismet.tgz ]; then
  echo "fixtures/akismet.tgz is missing; run npm run build and npm pack first" >&2
  exit 2
fi

case "$runtime" in
  node)
    # Both entry points: `import`, and `require()` from a CommonJS project.
    cd node
    rm -rf node_modules
    npm install --no-save --no-package-lock --ignore-scripts ../akismet.tgz
    node --version
    node import.mjs
    node require.cjs
    ;;
  bun)
    cd bun
    rm -rf node_modules
    bun install --no-save
    bun smoke.js
    ;;
  deno)
    # deno install cannot read a local tarball. The package has no dependencies, so
    # unpacking it is the whole install, and Deno still resolves it via `exports`.
    cd deno
    rm -rf node_modules
    mkdir -p node_modules/@automattic/akismet
    tar -xzf ../akismet.tgz -C node_modules/@automattic/akismet --strip-components=1
    deno run smoke.js
    ;;
  workers)
    # The lockfile pins wrangler; the tarball is installed on top without saving, so
    # its changing checksum never lands in the lockfile.
    cd workers
    npm ci --ignore-scripts
    npm install --no-save --ignore-scripts ../akismet.tgz
    WRANGLER_SEND_METRICS=false node smoke.js
    ;;
  types)
    # TYPESCRIPT names a compiler line (5.9, 6, 7); npm installs its newest release.
    cd types
    rm -rf node_modules
    npm install --no-save --no-package-lock --ignore-scripts ../akismet.tgz "typescript@${TYPESCRIPT:?set TYPESCRIPT, such as TYPESCRIPT=5.9}"
    npx --no-install tsc --version
    npx --no-install tsc -p .
    ;;
  *)
    echo "usage: fixtures/run.sh node|bun|deno|workers|types" >&2
    exit 2
    ;;
esac
