import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index.js'

export type Db = NodePgDatabase<typeof schema>
export type DbHandle = { db: Db; pool: Pool; close: () => Promise<void> }

/** Creates a pooled Drizzle client for a PostgreSQL connection string. */
export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const pool = new Pool({ connectionString: url, max: options.max ?? 10 })
  const db = drizzle(pool, { schema, casing: 'snake_case' })
  return { db, pool, close: () => pool.end() }
}

export { schema }
