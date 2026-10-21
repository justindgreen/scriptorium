import type { Pool } from 'pg'

/**
 * Runs `fn` while holding a session-level PostgreSQL advisory lock on a dedicated connection.
 * Used for one-time operations that span several statements or services (setup, migrations).
 */
export async function withAdvisoryLock<T>(
  pool: Pool,
  key: number,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [key])
    try {
      return await fn()
    } finally {
      await client.query('select pg_advisory_unlock($1)', [key])
    }
  } finally {
    client.release()
  }
}
