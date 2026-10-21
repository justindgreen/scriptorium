import { TRPCError } from '@trpc/server'
import path from 'node:path'
import { z } from 'zod'
import { procedureFor, router } from '../../core/trpc.js'
import { backupsDir, createBackup, listBackups, pruneBackups, verifyBackup } from './backup.js'

const nameSchema = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$/, 'invalid backup name')

/** Administrators create, list and verify backups. Restore is a CLI operation (docs/DEPLOYMENT.md). */
export const backupRouter = router({
  list: procedureFor('admin.backups.manage').query(({ ctx }) =>
    listBackups(ctx.config.DATA_DIR).map((b) => ({
      name: b.name,
      createdAt: b.manifest.createdAt,
      appVersion: b.manifest.appVersion,
      totalBytes: b.totalBytes,
      counts: b.manifest.counts,
      fileCount: b.manifest.files.length,
    })),
  ),

  create: procedureFor('admin.backups.manage').mutation(async ({ ctx }) => {
    const result = await createBackup({
      databaseUrl: ctx.databaseUrl,
      dataDir: ctx.config.DATA_DIR,
    })
    const pruned = pruneBackups(ctx.config.DATA_DIR, ctx.config.BACKUP_RETENTION)
    await ctx.audit.record({
      actorId: ctx.scope.userId,
      action: 'admin.backup.created',
      targetType: 'backup',
      targetId: result.name,
      metadata: { totalBytes: result.totalBytes, files: result.manifest.files.length, pruned },
      ip: ctx.ip,
    })
    return { name: result.name, totalBytes: result.totalBytes, pruned }
  }),

  verify: procedureFor('admin.backups.manage')
    .input(z.object({ name: nameSchema }))
    .query(({ ctx, input }) => {
      const dir = path.join(backupsDir(ctx.config.DATA_DIR), input.name)
      const result = verifyBackup(dir)
      if (!result.manifest && result.problems[0] === 'manifest.json is missing') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Backup not found.' })
      }
      return { ok: result.ok, problems: result.problems }
    }),
})
