import { buildApp } from './app.js'
import { loadConfig } from './core/config.js'
import { resolveAppSecret } from './core/secret.js'
import { connectDatabase } from './db/index.js'

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

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'shutting down')
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
