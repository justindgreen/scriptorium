import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'

/** Resolves to apps/server/drizzle whether running from src/ (tsx) or dist/ (tsup bundle). */
export const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  import.meta.url.includes('/dist/') ? '../drizzle' : '../../drizzle',
)

/** Application-wide advisory lock key so only one process migrates at a time. */
const MIGRATION_LOCK_KEY = 75_31_2026

/**
 * Applies pending SQL migrations under a PostgreSQL advisory lock. Safe to call from several
 * replicas or on every start: concurrent callers wait, then find nothing left to apply.
 */
export async function runMigrations(pool: Pool, folder: string = migrationsFolder): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    try {
      const db = drizzle(client)
      await migrate(db, { migrationsFolder: folder })
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    }
  } finally {
    client.release()
  }
}
