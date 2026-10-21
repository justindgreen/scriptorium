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
import {
  createBackup,
  listBackups,
  pruneBackups,
  restoreBackup,
  verifyBackup,
} from '../modules/backup/backup.js'

async function main(argv: string[]) {
  const [command, ...args] = argv
  if (!command || command === '--help' || command === '-h') {
    console.log(
      'commands: migrate | seed [dir] | import-content <file...> | sources | backup | backups | verify-backup <dir> | restore <dir> | prune [keep]',
    )
    return
  }
  const config = loadConfig()
  const database = await connectDatabase(config, {
    migrate: command !== 'restore' && command !== 'verify-backup',
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
      case 'backup': {
        const result = await createBackup({
          databaseUrl: database.url,
          dataDir: config.DATA_DIR,
          log: (m) => console.log(m),
        })
        const pruned = pruneBackups(config.DATA_DIR, config.BACKUP_RETENTION)
        console.log(
          `${result.name}: ${result.totalBytes} bytes${pruned.length ? `, pruned ${pruned.join(', ')}` : ''}`,
        )
        break
      }
      case 'backups': {
        for (const b of listBackups(config.DATA_DIR))
          console.log(
            `${b.name}\t${b.totalBytes} bytes\t${b.manifest.files.length} files\tapp ${b.manifest.appVersion}`,
          )
        break
      }
      case 'verify-backup': {
        if (!args[0]) throw new Error('verify-backup needs a backup directory')
        const result = verifyBackup(path.resolve(args[0]))
        console.log(
          result.ok ? 'backup verified' : `backup has problems:\n  ${result.problems.join('\n  ')}`,
        )
        if (!result.ok) process.exitCode = 1
        break
      }
      case 'restore': {
        if (!args[0]) throw new Error('restore needs a backup directory')
        const result = await restoreBackup({
          dir: path.resolve(args[0]),
          databaseUrl: database.url,
          dataDir: config.DATA_DIR,
          log: (m) => console.log(m),
        })
        console.log(
          `restored backup from ${result.manifest.createdAt} (${result.restoredFiles} files)`,
        )
        break
      }
      case 'prune': {
        const keep = args[0] ? Number(args[0]) : config.BACKUP_RETENTION
        console.log(`pruned: ${pruneBackups(config.DATA_DIR, keep).join(', ') || 'nothing'}`)
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
