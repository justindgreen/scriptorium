import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import type { Db } from '../../db/client.js'
import { schema } from '../../db/client.js'
import { newId } from '../../core/ids.js'
import type { Role } from '../../core/policy.js'

export type InviteService = ReturnType<typeof createInviteService>

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I to keep codes readable

function generateCode(length = 20): string {
  const bytes = randomBytes(length)
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length]
  }
  return `${code.slice(0, 5)}-${code.slice(5, 10)}-${code.slice(10, 15)}-${code.slice(15, 20)}`
}

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

export function createInviteService(db: Db) {
  return {
    /** Creates an invite and returns the plaintext code exactly once. */
    async create(input: {
      role: Role
      expiresInHours: number
      maxUses: number
      note?: string | null
      createdBy: string
    }) {
      const code = generateCode()
      const id = newId()
      const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000)
      await db.insert(schema.invites).values({
        id,
        codeHash: hashInviteCode(code),
        role: input.role,
        note: input.note ?? null,
        createdBy: input.createdBy,
        expiresAt,
        maxUses: input.maxUses,
      })
      return { id, code, expiresAt }
    },

    /**
     * Atomically consumes one use of a valid invite. Returns the granted role, or null when the
     * code is unknown, revoked, expired or exhausted. A use consumed by a sign-up that later fails
     * is not returned; the administrator can issue another invite.
     */
    async reserve(code: string): Promise<{ id: string; role: Role } | null> {
      const [row] = await db
        .update(schema.invites)
        .set({ uses: sql`${schema.invites.uses} + 1` })
        .where(
          and(
            eq(schema.invites.codeHash, hashInviteCode(code)),
            isNull(schema.invites.revokedAt),
            gt(schema.invites.expiresAt, new Date()),
            lt(schema.invites.uses, schema.invites.maxUses),
          ),
        )
        .returning({ id: schema.invites.id, role: schema.invites.role })
      return row ? { id: row.id, role: row.role === 'admin' ? 'admin' : 'user' } : null
    },

    async revoke(id: string): Promise<boolean> {
      const rows = await db
        .update(schema.invites)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.invites.id, id), isNull(schema.invites.revokedAt)))
        .returning({ id: schema.invites.id })
      return rows.length > 0
    },

    async list() {
      const rows = await db
        .select({
          id: schema.invites.id,
          role: schema.invites.role,
          note: schema.invites.note,
          createdBy: schema.invites.createdBy,
          createdByUsername: schema.user.username,
          expiresAt: schema.invites.expiresAt,
          maxUses: schema.invites.maxUses,
          uses: schema.invites.uses,
          revokedAt: schema.invites.revokedAt,
          createdAt: schema.invites.createdAt,
        })
        .from(schema.invites)
        .leftJoin(schema.user, eq(schema.user.id, schema.invites.createdBy))
        .orderBy(desc(schema.invites.createdAt))
      const now = Date.now()
      return rows.map((r) => ({
        ...r,
        status: r.revokedAt
          ? ('revoked' as const)
          : r.expiresAt.getTime() <= now
            ? ('expired' as const)
            : r.uses >= r.maxUses
              ? ('exhausted' as const)
              : ('active' as const),
      }))
    },
  }
}
