/**
 * Server command line: `pnpm -F @scriptorium/server cli -- <command> [args]`
 *   migrate                       apply pending migrations and exit
 *   seed [dir]                    import bundled rulesets and packages (default: repo content dir)
 *   import-content <file...>      import content packages or ruleset files
 *   sources                       list installed content sources with entry counts
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../core/config.js'
import { connectDatabase } from '../db/index.js'
import { ImportError, importPackage, upsertRuleset } from '../modules/content/import.js'
import { createContentRepo } from '../modules/content/repo.js'
import { seedBundledContent } from '../modules/content/seed.js'

async function main(argv: string[]) {
  const [command, ...args] = argv
  if (!command || command === '--help' || command === '-h') {
    console.log('commands: migrate | seed [dir] | import-content <file...> | sources')
    return
  }
  const config = loadConfig()
  const database = await connectDatabase(config, {
    migrate: true,
    onEmbeddedError: (m) => console.error('[embedded-postgres]', m),
  })
  try {
    switch (command) {
      case 'migrate':
        console.log('migrations applied')
        break
      case 'seed': {
        const report = await seedBundledContent(database.db, {
          ...(args[0] ? { contentDir: path.resolve(args[0]) } : {}),
          log: (m) => console.log(m),
        })
        console.log(`${report.rulesets.length} ruleset(s), ${report.packages.length} package(s)`)
        break
      }
      case 'import-content': {
        if (args.length === 0) throw new Error('import-content needs at least one file')
        for (const file of args) {
          const json = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as Record<
            string,
            unknown
          >
          if (json['format'] === 'scriptorium-content-package') {
            const r = await importPackage(database.db, json)
            console.log(
              `${file}: ${r.entries.created} created, ${r.entries.updated} updated, ${r.entries.unchanged} unchanged`,
            )
          } else {
            const r = await upsertRuleset(database.db, json)
            console.log(`${file}: ruleset ${r.id} ${r.changed ? 'updated' : 'unchanged'}`)
          }
        }
        break
      }
      case 'sources': {
        const sources = await createContentRepo(database.db).listSources()
        for (const s of sources)
          console.log(
            `${s.slug}\t${s.version}\t${s.entryCount} entries\t${s.isEnabled ? 'enabled' : 'disabled'}\t${s.license}`,
          )
        break
      }
      default:
        throw new Error(`unknown command "${command}"`)
    }
  } finally {
    await database.close()
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof ImportError) {
    console.error(error.message)
    for (const issue of error.issues.slice(0, 50))
      console.error(`  ${issue.path}: ${issue.message}`)
    if (error.issues.length > 50) console.error(`  ... ${error.issues.length - 50} more`)
  } else {
    console.error(error instanceof Error ? error.message : error)
  }
  process.exit(1)
})
