import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Db } from '../../db/client.js'
import { importPackage, upsertRuleset, type ImportResult } from './import.js'

export type SeedReport = {
  rulesets: Array<{ id: string; changed: boolean }>
  packages: Array<{ file: string; result: ImportResult }>
}

/** Default bundled content directory: <repo>/content in development, /app/content in the image. */
export function defaultContentDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, '../../../../../content'), // apps/server/src/modules/content -> repo root
    path.resolve(here, '../../../content'), // apps/server/dist -> ../../content (image layout mirrors repo)
    path.resolve(process.cwd(), 'content'),
  ]
  return candidates.find((c) => fs.existsSync(path.join(c, 'rulesets'))) ?? candidates[0]!
}

function walk(dir: string, predicate: (file: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, predicate))
    else if (predicate(entry.name)) out.push(full)
  }
  return out.sort()
}

/**
 * Loads bundled rulesets and content packages. Idempotent by checksum, so it runs on every
 * start and after image updates: unchanged entries cost one SELECT per source.
 */
export async function seedBundledContent(
  db: Db,
  options: { contentDir?: string; log?: (message: string) => void } = {},
): Promise<SeedReport> {
  const dir = options.contentDir ?? defaultContentDir()
  const log = options.log ?? (() => {})
  const report: SeedReport = { rulesets: [], packages: [] }

  for (const file of walk(path.join(dir, 'rulesets'), (f) => f.endsWith('.json'))) {
    const result = await upsertRuleset(db, JSON.parse(fs.readFileSync(file, 'utf8')))
    report.rulesets.push(result)
    log(`ruleset ${result.id}: ${result.changed ? 'updated' : 'unchanged'}`)
  }

  for (const file of walk(dir, (f) => f.endsWith('.package.json'))) {
    const result = await importPackage(db, JSON.parse(fs.readFileSync(file, 'utf8')))
    report.packages.push({ file: path.relative(dir, file), result })
    const c = result.entries
    log(
      `${path.relative(dir, file)}: ${c.created} created, ${c.updated} updated, ${c.unchanged} unchanged`,
    )
  }
  return report
}
