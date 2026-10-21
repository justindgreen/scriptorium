// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'

const pureEngineMessage =
  'The rules engine is pure: no I/O, database, HTTP, UI or randomness. See CLAUDE.md rule 2.'

/** Node built-ins and runtime packages the pure packages must never import. */
const impureModules = [
  'fs',
  'fs/promises',
  'path',
  'os',
  'crypto',
  'child_process',
  'http',
  'https',
  'net',
  'worker_threads',
  'react',
  'react-dom',
  'pg',
  'fastify',
  'drizzle-orm',
]

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // --- Boundary: the rules engine is pure and may import only content-schema and dice/ast.
  {
    files: ['packages/rules-engine/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@scriptorium/dice/roll',
              message:
                'The rules engine must never roll dice. Import @scriptorium/dice/ast only. See CLAUDE.md rule 2.',
            },
            ...impureModules.map((name) => ({ name, message: pureEngineMessage })),
          ],
          patterns: [
            { group: ['node:*'], message: pureEngineMessage },
            {
              group: [
                '@scriptorium/server',
                '@scriptorium/server/*',
                '@scriptorium/web',
                '@scriptorium/web/*',
              ],
              message: 'The rules engine must not depend on applications.',
            },
          ],
        },
      ],
    },
  },

  // --- Boundary: dice/ast has no RNG and no dependencies; dice/roll may not be pulled into ast.
  {
    files: ['packages/dice/src/ast/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@scriptorium/dice/roll', message: 'dice/ast must not depend on dice/roll.' },
            ...impureModules.map((name) => ({ name, message: 'dice/ast has no dependencies.' })),
          ],
          patterns: [
            { group: ['node:*'], message: 'dice/ast has no dependencies.' },
            {
              group: ['../roll', '../roll/*', '../../roll/*'],
              message: 'dice/ast must not depend on dice/roll.',
            },
          ],
        },
      ],
    },
  },

  // --- Boundary: content-schema depends only on zod.
  {
    files: ['packages/content-schema/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: impureModules.map((name) => ({
            name,
            message: 'content-schema depends only on zod.',
          })),
          patterns: [
            { group: ['node:*'], message: 'content-schema depends only on zod.' },
            { group: ['@scriptorium/*'], message: 'content-schema is a leaf package.' },
          ],
        },
      ],
    },
  },

  // --- Boundary: the web app may import server types only, never server runtime code.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      // Scrollable regions must be keyboard reachable (axe: scrollable-region-focusable).
      'jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['tabpanel', 'region'] }],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@scriptorium/server', '@scriptorium/server/*'],
              allowTypeImports: true,
              message: 'The web app may import server types only. See CLAUDE.md rule 1.',
            },
            {
              group: ['@scriptorium/dice/roll'],
              message: 'The web app never rolls locally; rolls are explicit server steps.',
            },
          ],
        },
      ],
    },
  },
)
