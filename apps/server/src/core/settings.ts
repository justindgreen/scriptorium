import { count, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { schema } from '../db/client.js'

export type Settings = ReturnType<typeof createSettings>

/** Small key/value store for instance-level settings, plus the setup-complete rule. */
export function createSettings(db: Db) {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const [row] = await db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, key))
        .limit(1)
      return row?.value as T | undefined
    },

    async set(key: string, value: unknown): Promise<void> {
      await db
        .insert(schema.appSettings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value, updatedAt: sql`now()` },
        })
    },

    /** Setup is complete once the first (administrator) account exists. */
    async isSetupComplete(): Promise<boolean> {
      const [row] = await db.select({ n: count() }).from(schema.user)
      return (row?.n ?? 0) > 0
    },

    async instanceName(): Promise<string> {
      return (await this.get<string>('instance_name')) ?? 'Scriptorium'
    },
  }
}
