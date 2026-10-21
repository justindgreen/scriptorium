import fs from 'node:fs'
import path from 'node:path'

/**
 * Fetches the upstream SRD 5.1 (2014) dataset published by the 5e-bits project
 * (https://github.com/5e-bits/5e-database). The dataset is downloaded data: it is written to an
 * isolated directory, parsed as JSON only, and never executed. Its LICENSE file is saved next to
 * the data and checked before conversion.
 */
export const UPSTREAM_REPO = 'https://raw.githubusercontent.com/5e-bits/5e-database/main'

export const UPSTREAM_FILES = [
  'Ability-Scores',
  'Backgrounds',
  'Classes',
  'Conditions',
  'Damage-Types',
  'Equipment',
  'Equipment-Categories',
  'Feats',
  'Features',
  'Languages',
  'Levels',
  'Magic-Items',
  'Magic-Schools',
  'Monsters',
  'Proficiencies',
  'Races',
  'Rule-Sections',
  'Rules',
  'Skills',
  'Spells',
  'Subclasses',
  'Subraces',
  'Traits',
  'Weapon-Properties',
] as const

export type UpstreamFile = (typeof UPSTREAM_FILES)[number]

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.text()
}

export async function downloadUpstream(
  outDir: string,
  log: (m: string) => void = () => {},
): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true })
  const license =
    (await fetchText(`${UPSTREAM_REPO}/LICENSE.md`)) ??
    (await fetchText(`${UPSTREAM_REPO}/LICENSE`))
  if (!license) throw new Error('upstream LICENSE not found')
  fs.writeFileSync(path.join(outDir, 'LICENSE'), license)
  log(`LICENSE (${license.split('\n')[0]?.trim()})`)

  for (const name of UPSTREAM_FILES) {
    const file = `5e-SRD-${name}.json`
    let text: string | null = null
    for (const base of ['src/2014/en', 'src/2014', 'src']) {
      text = await fetchText(`${UPSTREAM_REPO}/${base}/${file}`)
      if (text) break
    }
    if (!text) throw new Error(`${file} not found upstream`)
    JSON.parse(text) // fail early on anything that is not JSON
    fs.writeFileSync(path.join(outDir, file), text)
    log(`${file} (${(text.length / 1024).toFixed(0)} KB)`)
  }
}

export function readUpstream<T = unknown>(dir: string, name: UpstreamFile): T[] {
  return JSON.parse(fs.readFileSync(path.join(dir, `5e-SRD-${name}.json`), 'utf8')) as T[]
}
