import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type App } from '../src/app.js'
import { loadConfig } from '../src/core/config.js'
import { maintenanceMarkerPath } from '../src/core/maintenance.js'
import { createDb } from '../src/db/client.js'
import {
  createBackup,
  listBackups,
  pruneBackups,
  restoreBackup,
  verifyBackup,
} from '../src/modules/backup/backup.js'
import { importPackage, upsertRuleset } from '../src/modules/content/import.js'
import { defaultContentDir } from '../src/modules/content/seed.js'
import {
  createTestApp,
  setupAdmin,
  TEST_SECRET,
  trpcMutation,
  trpcQuery,
  type TestApp,
} from './helpers/app.js'
import { createTestDatabase, type TestDatabase } from './helpers/database.js'

/**
 * Restore acceptance (docs/TEST_STRATEGY.md §5): back up instance A, restore into a fresh
 * instance B, then use B: the restored session works, content counts match, the uploaded file
 * is byte-identical, and the maintenance marker is gone.
 */
describe('backup, verify and restore', () => {
  let a: TestApp
  let dataDirA = ''
  let dataDirB = ''
  let adminCookie = ''
  let backupDir = ''
  let uploadSha = ''
  const uploadRel = 'ab/cd/abcd1234.png'

  beforeAll(async () => {
    dataDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptorium-a-'))
    dataDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptorium-b-'))
    a = await createTestApp()
    adminCookie = (await setupAdmin(a.app)).cookie
    const ruleset = JSON.parse(
      fs.readFileSync(path.join(defaultContentDir(), 'rulesets', 'srd5.1-2014.json'), 'utf8'),
    )
    await upsertRuleset(a.tdb.db, ruleset)
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(defaultContentDir(), 'srd-5.1', 'srd-5.1.backgrounds-feats.package.json'),
        'utf8',
      ),
    )
    await importPackage(a.tdb.db, pkg)
    const upload = path.join(dataDirA, 'uploads', uploadRel)
    fs.mkdirSync(path.dirname(upload), { recursive: true })
    fs.writeFileSync(upload, Buffer.from('not really a png, but immutable bytes'))
    uploadSha = createHash('sha256').update(fs.readFileSync(upload)).digest('hex')
  })

  afterAll(async () => {
    await a.close()
    fs.rmSync(dataDirA, { recursive: true, force: true })
    fs.rmSync(dataDirB, { recursive: true, force: true })
  })

  it('creates a backup with a manifest, a dump and the uploaded files', async () => {
    const result = await createBackup({
      databaseUrl: a.tdb.url,
      dataDir: dataDirA,
      now: new Date('2026-10-21T20:00:00Z'),
    })
    backupDir = result.dir
    expect(result.name).toBe('2026-10-21_20-00-00')
    expect(result.manifest.counts).toMatchObject({ users: 1, content_entries: 2 })
    expect(result.manifest.files).toEqual([{ path: uploadRel, size: 37, sha256: uploadSha }])
    expect(result.manifest.schemaTag).toBeTruthy()
    expect(result.manifest.tables.map((t) => t.name)).toContain('content_entries')
    expect(fs.statSync(path.join(backupDir, 'db', 'users.csv')).size).toBeGreaterThan(50)
    expect(listBackups(dataDirA).map((b) => b.name)).toEqual([result.name])
  })

  it('verifies checksums and detects tampering', () => {
    expect(verifyBackup(backupDir)).toMatchObject({ ok: true, problems: [] })
    const file = path.join(backupDir, 'uploads', uploadRel)
    const original = fs.readFileSync(file)
    fs.writeFileSync(file, Buffer.from('tampered'))
    expect(verifyBackup(backupDir).problems).toEqual([
      `uploaded file checksum mismatch: ${uploadRel}`,
    ])
    fs.writeFileSync(file, original)
    expect(verifyBackup(path.join(dataDirA, 'nope')).problems).toEqual(['manifest.json is missing'])
  })

  it('restores into a fresh instance that then works end to end', async () => {
    const b: TestDatabase = await createTestDatabase({ migrate: false })
    let appB: App | null = null
    try {
      const restored = await restoreBackup({
        dir: backupDir,
        databaseUrl: b.url,
        dataDir: dataDirB,
      })
      expect(restored.restoredFiles).toBe(1)
      expect(fs.existsSync(maintenanceMarkerPath(dataDirB))).toBe(false)
      expect(
        createHash('sha256')
          .update(fs.readFileSync(path.join(dataDirB, 'uploads', uploadRel)))
          .digest('hex'),
      ).toBe(uploadSha)

      const config = loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: b.url,
        APP_SECRET: TEST_SECRET,
        PUBLIC_URL: 'http://localhost:3000',
        DATA_DIR: dataDirB,
        SEED_CONTENT: 'false',
      })
      appB = await buildApp({
        config,
        database: { db: b.db, pool: b.pool, url: b.url },
        secret: TEST_SECRET,
      })
      await appB.ready()

      const ready = await appB.inject({ method: 'GET', url: '/readyz' })
      expect(ready.statusCode).toBe(200)
      const me = await trpcQuery<{ username: string; role: string }>(
        appB,
        'me.get',
        undefined,
        adminCookie,
      )
      expect(me.data).toMatchObject({ username: 'gamemaster', role: 'admin' })
      const licensesA = await trpcQuery<Array<{ slug: string; entryCount: number }>>(
        a.app,
        'content.licenses',
      )
      const licensesB = await trpcQuery<Array<{ slug: string; entryCount: number }>>(
        appB,
        'content.licenses',
      )
      expect(licensesB.data).toEqual(licensesA.data)
      const entry = await trpcQuery<{ name: string }>(
        appB,
        'content.entries.get',
        { uid: 'srd-5.1:feat:grappler' },
        adminCookie,
      )
      expect(entry.data?.name).toBe('Grappler')
      const audit = await trpcQuery<Array<{ action: string }>>(
        appB,
        'admin.audit.list',
        { limit: 10 },
        adminCookie,
      )
      expect(audit.data?.some((e) => e.action === 'setup.completed')).toBe(true)
    } finally {
      await appB?.close()
      await b.drop()
    }
  })

  it('serves 503 outside health endpoints while the maintenance marker exists', async () => {
    const marker = maintenanceMarkerPath(a.app.services.config.DATA_DIR)
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(marker, '{}')
    try {
      await new Promise((r) => setTimeout(r, 1100))
      const blocked = await a.app.inject({ method: 'GET', url: '/api/trpc/system.status' })
      expect(blocked.statusCode).toBe(503)
      const health = await a.app.inject({ method: 'GET', url: '/healthz' })
      expect(health.statusCode).toBe(200)
      const ready = await a.app.inject({ method: 'GET', url: '/readyz' })
      expect(ready.json()).toMatchObject({ status: 'maintenance' })
    } finally {
      fs.rmSync(marker, { force: true })
      await new Promise((r) => setTimeout(r, 1100))
    }
    const open = await a.app.inject({ method: 'GET', url: '/api/trpc/system.status' })
    expect(open.statusCode).toBe(200)
  })

  it('exposes backups to administrators only and prunes old ones', async () => {
    const forbidden = await trpcQuery(a.app, 'admin.backups.list')
    expect(forbidden.error?.code).toBe('UNAUTHORIZED')
    const created = await trpcMutation<{ name: string; totalBytes: number }>(
      a.app,
      'admin.backups.create',
      undefined,
      adminCookie,
    )
    expect(created.data?.totalBytes).toBeGreaterThan(0)
    const list = await trpcQuery<Array<{ name: string; fileCount: number }>>(
      a.app,
      'admin.backups.list',
      undefined,
      adminCookie,
    )
    expect(list.data?.length).toBeGreaterThanOrEqual(1)
    const verify = await trpcQuery<{ ok: boolean }>(
      a.app,
      'admin.backups.verify',
      { name: created.data!.name },
      adminCookie,
    )
    expect(verify.data?.ok).toBe(true)
    const dataDir = a.app.services.config.DATA_DIR
    const before = listBackups(dataDir).length
    const removed = pruneBackups(dataDir, 1)
    expect(removed).toHaveLength(Math.max(0, before - 1))
    expect(listBackups(dataDir)).toHaveLength(Math.min(before, 1))
  })

  it('refuses to restore a backup that fails verification', async () => {
    const broken = path.join(dataDirA, 'broken-backup')
    fs.mkdirSync(broken, { recursive: true })
    fs.writeFileSync(
      path.join(broken, 'manifest.json'),
      JSON.stringify({
        format: 'scriptorium-backup',
        formatVersion: 1,
        dump: { file: 'db.dump', size: 0, sha256: 'x' },
        files: [],
      }),
    )
    await expect(
      restoreBackup({ dir: broken, databaseUrl: a.tdb.url, dataDir: dataDirA }),
    ).rejects.toThrow(/failed verification/)
    expect(fs.existsSync(maintenanceMarkerPath(dataDirA))).toBe(false)
    expect(createDb).toBeTypeOf('function')
  })
})
