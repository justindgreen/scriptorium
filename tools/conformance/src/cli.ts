/**
 * pnpm coverage:automation  -> writes docs/AUTOMATION_COVERAGE.md and prints the alpha gate.
 * Exits non-zero when any behavioural case fails or any declaration is violated.
 */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { alphaGate, renderReport, summarize } from './report.js'
import { loadContent, runConformance } from './run.js'

const root = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..', '..'))
const loaded = loadContent(root)
const reports = runConformance(loaded)
const gate = alphaGate(loaded, reports)
const total = summarize(reports)
const out = join(root, 'docs', 'AUTOMATION_COVERAGE.md')
writeFileSync(out, renderReport(loaded, reports, 'pnpm coverage:automation') + '\n')

console.log(
  `entries ${total.total}: full ${total.full}, partial ${total.partial}, manual ${total.manual}, pending ${total.pending + total.none}; verified ${total.verified}, unverified ${total.unverified}`,
)
console.log(
  `alpha: verified ${Math.round(gate.verifiedShare * 1000) / 10}% of full/partial, class features full or partial ${Math.round(gate.fullOrPartialShare * 1000) / 10}%, manual off-list ${gate.manualOffList.length}, violations ${gate.violations.length}, pending ${gate.pending.length}`,
)
console.log(`wrote ${out}`)

const failing = reports.filter((r) => r.violations.length > 0 || r.cases.some((c) => !c.ok))
if (failing.length > 0) {
  for (const r of failing.slice(0, 40)) {
    for (const v of r.violations) console.error(`${r.uid}: ${v}`)
    for (const c of r.cases.filter((c) => !c.ok))
      console.error(`${r.uid} / ${c.name}: ${c.message}`)
  }
  process.exit(1)
}
