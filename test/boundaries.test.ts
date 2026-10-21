/**
 * Proves that the module-boundary lint rules in eslint.config.js reject forbidden imports.
 * These fixtures are linted in memory; no files are written.
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: rootDir })

async function restrictedImportMessages(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(rootDir, filePath) })
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === '@typescript-eslint/no-restricted-imports')
    .map((m) => m.message)
}

describe('module boundaries', () => {
  it('rejects dice/roll inside the rules engine', async () => {
    const messages = await restrictedImportMessages(
      "import { packageName } from '@scriptorium/dice/roll'\nexport const x = packageName\n",
      'packages/rules-engine/src/__boundary_fixture__.ts',
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/must never roll dice/)
  })

  it('rejects Node built-ins inside the rules engine', async () => {
    const messages = await restrictedImportMessages(
      "import { readFileSync } from 'node:fs'\nexport const x = readFileSync\n",
      'packages/rules-engine/src/__boundary_fixture__.ts',
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/pure/)
  })

  it('allows dice/ast and content-schema inside the rules engine', async () => {
    const messages = await restrictedImportMessages(
      "import { packageName } from '@scriptorium/dice/ast'\nimport { schemaPackageName } from '@scriptorium/content-schema'\nexport const x = [packageName, schemaPackageName]\n",
      'packages/rules-engine/src/__boundary_fixture__.ts',
    )
    expect(messages).toHaveLength(0)
  })

  it('rejects dice/roll inside dice/ast', async () => {
    const messages = await restrictedImportMessages(
      "import { packageName } from '../roll/index.js'\nexport const x = packageName\n",
      'packages/dice/src/ast/__boundary_fixture__.ts',
    )
    expect(messages).toHaveLength(1)
  })

  it('rejects server runtime imports in the web app but allows type imports', async () => {
    const runtime = await restrictedImportMessages(
      "import { buildApp } from '@scriptorium/server'\nexport const x = buildApp\n",
      'apps/web/src/__boundary_fixture__.ts',
    )
    expect(runtime).toHaveLength(1)
    expect(runtime[0]).toMatch(/server types only/)

    const typeOnly = await restrictedImportMessages(
      "import type { AppRouter } from '@scriptorium/server'\nexport type X = AppRouter\n",
      'apps/web/src/__boundary_fixture__.ts',
    )
    expect(typeOnly).toHaveLength(0)
  })
})
