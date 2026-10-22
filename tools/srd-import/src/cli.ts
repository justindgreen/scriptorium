/**
 * pnpm -F @scriptorium/srd-import download -- --out <dir>
 * pnpm -F @scriptorium/srd-import convert  -- --source <dir> --out content/srd-5.1 [--overlays content/srd-5.1/mechanics]
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildPackages, type Overlay } from './convert.js'
import { downloadUpstream } from './download.js'

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const value = i >= 0 ? process.argv[i + 1] : undefined
  if (!value && fallback === undefined) throw new Error(`--${name} is required`)
  return value ?? fallback!
}

function loadOverlays(dir: string): Overlay[] {
  if (!fs.existsSync(dir)) return []
  const overlays: Overlay[] = []
  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as
      Overlay[] | { entries: Overlay[] }
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.entries)
        ? parsed.entries
        : undefined
    const FIELDS = ['effects', 'choices', 'automation', 'tests', 'tags', 'data']
    const isOverlay = (o: unknown): boolean =>
      typeof o === 'object' && o !== null && 'uid' in o && FIELDS.some((f) => f in (o as object))
    if (!list || !list.every(isOverlay)) continue // manifests and allow-lists live beside overlays
    overlays.push(...list)
  }
  return overlays
}

async function main() {
  const command = process.argv[2]
  if (command === 'download') {
    const out = path.resolve(arg('out'))
    await downloadUpstream(out, (m) => console.log(m))
    console.log(`downloaded to ${out}`)
    return
  }
  if (command === 'convert') {
    const source = path.resolve(arg('source'))
    const out = path.resolve(arg('out'))
    const overlaysDir = path.resolve(arg('overlays', path.join(out, 'mechanics')))
    const license = fs.existsSync(path.join(source, 'LICENSE'))
      ? fs.readFileSync(path.join(source, 'LICENSE'), 'utf8')
      : ''
    if (!/MIT/i.test(license))
      throw new Error(
        'upstream LICENSE is missing or not the expected MIT licence; refusing to convert',
      )
    const overlays = loadOverlays(overlaysDir)
    const result = buildPackages(source, overlays)
    fs.mkdirSync(out, { recursive: true })
    for (const { name, package: pkg } of result.packages) {
      const file = path.join(out, `srd-5.1.${name}.package.json`)
      fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
      const kinds = new Map<string, number>()
      for (const e of pkg.entries) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1)
      console.log(
        `${path.basename(file)}: ${pkg.entries.length} entries (${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')})`,
      )
    }
    for (const { name, issues } of result.issues) {
      console.error(`${name}: ${issues.length} validation issue(s)`)
      for (const issue of issues.slice(0, 40)) console.error(`  ${issue.path}: ${issue.message}`)
    }
    if (result.unmatchedOverlays.length > 0)
      console.error(`overlays without a matching entry: ${result.unmatchedOverlays.join(', ')}`)
    if (result.issues.length > 0) process.exit(1)
    return
  }
  console.log(
    'commands: download --out <dir> | convert --source <dir> --out <dir> [--overlays <dir>]',
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
