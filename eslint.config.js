import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier/flat';
import importPlugin from 'eslint-plugin-import-x';
import nPlugin from 'eslint-plugin-n';
import unicornPlugin from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  nPlugin.configs['flat/recommended-module'],
  unicornPlugin.configs.recommended,
  {
    plugins: { 'import-x': importPlugin },
    rules: {
      // fetch/Request/Response are stable on every supported Node line (22+) and required by this SDK.
      'n/no-unsupported-features/node-builtins': 'off',
      // Stylistic noise we don't want to enforce across a small SDK codebase.
      'unicorn/name-replacements': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/no-for-each': 'off',
      'unicorn/no-negated-condition': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/catch-error-name': 'off',
      'unicorn/prefer-string-replace-all': 'off',
      // JSDoc blocks keep their `*` prefixes, and one-line `/** … */` comments stay on one line.
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
      'unicorn/single-line-block-comment-style': 'off',
      // `.catch((error: unknown) => error)` is how a test captures a rejection to inspect it.
      'unicorn/prefer-await': 'off',
      // Redaction copies name, stack, and cause onto a fresh Error on purpose.
      'unicorn/no-error-property-assignment': 'off',
      // `check(fields, options)` is public API, and every method takes RequestOptions last.
      'unicorn/prefer-options-parameter': 'off',
      // `key in options` tells an explicit `undefined` apart from a missing key.
      'unicorn/no-computed-property-existence-check': 'off',
      // `viaSupport` is a public field, so renaming it would break callers.
      'unicorn/consistent-boolean-name': 'off',
      // Iterator#toArray() needs the ES2025 lib; the repo type-checks against ES2023.
      'unicorn/prefer-iterator-to-array': 'off',
      // The SDK sorts only strings, where the default order is the one we want.
      'unicorn/require-array-sort-compare': 'off',
      // Readability calls that the rule cannot make: member order, condition order,
      // ternaries, spreads, loop headers, and where declarations go.
      'unicorn/consistent-class-member-order': 'off',
      'unicorn/prefer-simple-condition-first': 'off',
      'unicorn/prefer-ternary': 'off',
      'unicorn/consistent-conditional-object-spread': 'off',
      'unicorn/no-unreadable-for-of-expression': 'off',
      'unicorn/no-declarations-before-early-exit': 'off',
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      // `_label` marks a parameter a callback must accept but does not read, like an it.each label.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'import-x/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'parent', 'sibling', 'index'],
          // The examples import the SDK by its package name. That name resolves to dist/
          // once a build exists, which would rank it as a local file, so pin its group.
          pathGroups: [{ pattern: '@automattic/akismet', group: 'external' }],
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Core must run on edge runtimes, and its published typings must compile without
    // @types/node, so not even a type-only import of a Node built-in is allowed.
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: 'src/ must stay runtime-neutral; declare a structural type instead.',
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
  {
    // ESLint config and other JS files don't participate in the type-aware tsconfig.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { parserOptions: { project: null } },
  },
  {
    // Examples import the SDK by package name; their tsconfig maps it to src/.
    files: ['examples/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './examples/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Fixtures import the packed tarball, which fixtures/run.sh installs only when it runs.
    files: ['fixtures/**'],
    rules: {
      'n/no-missing-import': ['error', { allowModules: ['@automattic/akismet'] }],
      'n/no-missing-require': ['error', { allowModules: ['@automattic/akismet'] }],
    },
  },
  {
    // Fixtures run against the installed tarball in the CI runtimes matrix; that run is
    // their check. Linting them here would need each fixture's own install (wrangler, etc.).
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'fixtures/**'],
  }
);
