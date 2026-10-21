import { desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { schema } from '../db/client.js'
import { newId } from './ids.js'

export type AuditEntry = {
  actorId?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown>
  ip?: string | null
}

export type Audit = ReturnType<typeof createAudit>

/** Append-only record of administrative and security-relevant actions. */
export function createAudit(db: Db) {
  return {
    async record(entry: AuditEntry): Promise<void> {
      await db.insert(schema.auditLog).values({
        id: newId(),
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata ?? null,
        ip: entry.ip ?? null,
      })
    },

    async list(limit = 100) {
      return db
        .select({
          id: schema.auditLog.id,
          action: schema.auditLog.action,
          actorId: schema.auditLog.actorId,
          actorUsername: schema.user.username,
          targetType: schema.auditLog.targetType,
          targetId: schema.auditLog.targetId,
          metadata: schema.auditLog.metadata,
          ip: schema.auditLog.ip,
          createdAt: schema.auditLog.createdAt,
        })
        .from(schema.auditLog)
        .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(limit)
    },
  }
}
