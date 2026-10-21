import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { inject } from 'vitest'
import { createDb, type DbHandle } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'

export type TestDatabase = DbHandle & { url: string; drop: () => Promise<void> }

/**
 * Creates a fresh, migrated database for one test file on the shared test server.
 * Call `drop()` in afterAll.
 */
export async function createTestDatabase(
  options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  const adminUrl = inject('pgAdminUrl')
  const name = `t_${randomBytes(6).toString('hex')}`
  await withAdmin(adminUrl, (c) => c.query(`create database "${name}"`))

  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  const handle = createDb(url.toString(), { max: 4 })
  if (options.migrate ?? true) {
    await runMigrations(handle.pool)
  }

  return {
    ...handle,
    url: url.toString(),
    drop: async () => {
      await handle.close()
      await withAdmin(adminUrl, (c) => c.query(`drop database if exists "${name}" with (force)`))
    },
  }
}

async function withAdmin<T>(adminUrl: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}
