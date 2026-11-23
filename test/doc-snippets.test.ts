import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Values the snippets assume the reader already has. Declared as globals in a script
 * file, so a snippet that declares or imports the same name shadows them.
 */
const AMBIENT = `
type Sdk = typeof import('@automattic/akismet');
declare const Akismet: Sdk['Akismet'];
declare const SpamVerdict: Sdk['SpamVerdict'];
declare const ContentType: Sdk['ContentType'];
declare const contentFromRequest: Sdk['contentFromRequest'];
declare const getConnInfo: typeof import('@hono/node-server/conninfo').getConnInfo;
declare const akismet: import('@automattic/akismet').Akismet;
declare const content: import('@automattic/akismet').Content;
declare const result: import('@automattic/akismet').CheckResult;
/** An Express request: a Node IncomingMessage with a parsed, untyped body. */
declare const req: import('node:http').IncomingMessage & { body: any };
/** A Web Request, as Hono, Next.js route handlers, and Workers hand you. */
declare const request: Request;
declare const c: import('hono').Context;
declare const body: string;
declare const form: { message: string; name: string; email: string };
declare const session: { user?: { role: string } };
declare const tenant: { akismetKey: string; url: string };
declare const moderator: { username: string };
/** A stored submission: the content and result, each serialized with JSON.stringify. */
declare const row: { content: string; verdict: import('@automattic/akismet').SpamVerdict };
declare const controller: AbortController;
declare const myFetch: typeof fetch;
declare const apiKey: string;
declare const site: string;
`;

function tsBlocks(file: string): string[] {
  const markdown = readFileSync(path.join(ROOT, file), 'utf8');
  return [...markdown.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((match) => match[1] ?? '');
}

/** Typecheck every block as its own ES module against the SDK source. */
function diagnostics(file: string): string[] {
  const sources = new Map<string, string>([[path.join(ROOT, 'snippets', 'ambient.d.ts'), AMBIENT]]);
  for (const [index, code] of tsBlocks(file).entries()) {
    sources.set(
      path.join(ROOT, 'snippets', `${file}.${String(index)}.mts`),
      `${code}\nexport {};\n`
    );
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
    types: ['node'],
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    noEmit: true,
    paths: { '@automattic/akismet': [path.join(ROOT, 'src/index.ts')] },
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (name) => sources.get(name) ?? readFile(name);
  host.fileExists = (name) => sources.has(name) || fileExists(name);
  host.getSourceFile = (name, version, onError, create) => {
    const text = sources.get(name);
    return text === undefined
      ? getSourceFile(name, version, onError, create)
      : ts.createSourceFile(name, text, version);
  };

  const program = ts.createProgram([...sources.keys()], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file !== undefined && sources.has(d.file.fileName))
    .map((d) => {
      const where = d.file?.getLineAndCharacterOfPosition(d.start ?? 0);
      const name = path.basename(d.file?.fileName ?? '');
      const line = String((where?.line ?? 0) + 1);
      return `${name}:${line} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });
}

// Readers paste the first snippet they see, so every ts block must compile as written.
describe('documentation snippets', () => {
  it.each(['README.md', 'SKILL.md', 'SECURITY.md'])(
    'every ts block in %s typechecks',
    (file) => {
      expect(diagnostics(file)).toEqual([]);
    },
    30_000
  );
});
