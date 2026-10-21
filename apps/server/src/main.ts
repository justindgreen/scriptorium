import { Cron } from 'croner'
import { buildApp } from './app.js'
import { createBackup, pruneBackups } from './modules/backup/backup.js'
import { loadConfig } from './core/config.js'
import { resolveAppSecret } from './core/secret.js'
import { connectDatabase } from './db/index.js'
import { seedBundledContent } from './modules/content/seed.js'

async function main() {
  const config = loadConfig()
  const secret = resolveAppSecret(config)
  const database = await connectDatabase(config, {
    onEmbeddedError: (message) => console.error('[embedded-postgres]', message),
  })
  const app = await buildApp({ config, database, secret })

  if (database.embedded) {
    app.log.info(
      { url: database.url.replace(/:[^:@]+@/, ':***@') },
      'using embedded development database',
    )
  }

  if (config.SEED_CONTENT) {
    const report = await seedBundledContent(database.db, {
      ...(config.CONTENT_DIR ? { contentDir: config.CONTENT_DIR } : {}),
      log: (message) => app.log.info(message),
    })
    app.log.info(
      { rulesets: report.rulesets.length, packages: report.packages.length },
      'bundled content checked',
    )
  }

  let schedule: Cron | null = null
  if (config.BACKUP_CRON) {
    schedule = new Cron(config.BACKUP_CRON, { protect: true }, async () => {
      try {
        const result = await createBackup({
          databaseUrl: database.url,
          dataDir: config.DATA_DIR,
          log: (m) => app.log.info(m),
        })
        const pruned = pruneBackups(config.DATA_DIR, config.BACKUP_RETENTION)
        app.log.info(
          { name: result.name, bytes: result.totalBytes, pruned },
          'scheduled backup done',
        )
      } catch (error) {
        app.log.error({ err: error }, 'scheduled backup failed')
      }
    })
    app.log.info(
      { cron: config.BACKUP_CRON, next: schedule.nextRun()?.toISOString() },
      'backup schedule active',
    )
  }

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'shutting down')
    schedule?.stop()
    await app.close()
    await database.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host: config.HOST, port: config.PORT })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
