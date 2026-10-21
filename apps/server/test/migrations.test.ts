import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '../src/db/migrate.js'
import { createTestDatabase, type TestDatabase } from './helpers/database.js'

describe('database migrations', () => {
  let tdb: TestDatabase

  beforeAll(async () => {
    tdb = await createTestDatabase({ migrate: false })
  })

  afterAll(async () => {
    await tdb.drop()
  })

  it('applies all migrations to an empty database and is idempotent', async () => {
    await runMigrations(tdb.pool)
    const first = await tdb.db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    )
    await runMigrations(tdb.pool)
    const second = await tdb.db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    )
    expect(Number(first.rows[0]?.count)).toBeGreaterThan(0)
    expect(second.rows[0]?.count).toBe(first.rows[0]?.count)
  })

  it('creates the identity tables', async () => {
    const result = await tdb.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    )
    const names = result.rows.map((r) => r.table_name)
    for (const expected of [
      'accounts',
      'app_settings',
      'audit_log',
      'invites',
      'sessions',
      'users',
      'verifications',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('serialises concurrent migrators with the advisory lock', async () => {
    await expect(
      Promise.all([runMigrations(tdb.pool), runMigrations(tdb.pool)]),
    ).resolves.toBeDefined()
  })
})
