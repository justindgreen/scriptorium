import path from 'node:path'
import type { Config } from '../core/config.js'
import { createDb, type DbHandle } from './client.js'
import { startEmbeddedPostgres, type EmbeddedHandle } from './embedded.js'
import { runMigrations } from './migrate.js'

export type Database = DbHandle & {
  url: string
  embedded: EmbeddedHandle | null
}

/**
 * Connects to DATABASE_URL, or starts the embedded development database when it is unset
 * (never in production), then applies pending migrations under the advisory lock.
 */
export async function connectDatabase(
  config: Config,
  options: { migrate?: boolean; onEmbeddedError?: (message: string) => void } = {},
): Promise<Database> {
  let embedded: EmbeddedHandle | null = null
  let url = config.DATABASE_URL

  if (!url) {
    if (config.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is required in production')
    }
    embedded = await startEmbeddedPostgres({
      dataDir: path.join(config.DATA_DIR, 'pg'),
      port: config.DEV_PG_PORT,
      persistent: true,
      database: 'scriptorium',
      ...(options.onEmbeddedError ? { onError: options.onEmbeddedError } : {}),
    })
    url = embedded.url
  }

  const handle = createDb(url)
  if (options.migrate ?? true) {
    await runMigrations(handle.pool)
  }

  return {
    ...handle,
    url,
    embedded,
    close: async () => {
      await handle.close()
      await embedded?.stop()
    },
  }
}

export type { Db, DbHandle } from './client.js'
export { schema } from './client.js'
