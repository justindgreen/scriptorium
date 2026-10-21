import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Client, Pool } from 'pg'
import { from as copyFrom, to as copyTo } from 'pg-copy-streams'
import { maintenanceMarkerPath } from '../../core/maintenance.js'
import { APP_VERSION } from '../../core/version.js'
import { runMigrations } from '../../db/migrate.js'

/**
 * Logical backups (ADR-0028): every application table is exported with PostgreSQL COPY to a CSV
 * file, with checksums, plus a copy of every uploaded file. Restore recreates the schema with our
 * own migrations, truncates the application tables and loads the CSV files in dependency order.
 * No external client binaries are needed, so dev, tests and the image share one code path.
 */
export const BACKUP_FORMAT = 'scriptorium-backup' as const
export const BACKUP_FORMAT_VERSION = 1 as const

export type TableDump = {
  name: string
  columns: string[]
  rows: number
  file: string
  size: number
  sha256: string
}

export type BackupManifest = {
  format: typeof BACKUP_FORMAT
  formatVersion: typeof BACKUP_FORMAT_VERSION
  createdAt: string
  appVersion: string
  postgresVersion: string
  /** Last applied migration (drizzle hash) at backup time. */
  schemaTag: string | null
  counts: Record<string, number>
  /** Application tables in dependency order (parents first). */
  tables: TableDump[]
  /** Uploaded files copied into `uploads/` inside the backup, relative paths with hashes. */
  files: Array<{ path: string; size: number; sha256: string }>
}

export type BackupOptions = {
  databaseUrl: string
  dataDir: string
  now?: Date
  log?: (message: string) => void
}

export type BackupSummary = {
  name: string
  dir: string
  manifest: BackupManifest
  totalBytes: number
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function walk(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, base))
    else out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out.sort()
}

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export function backupsDir(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'backups')
}

export function uploadsDir(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'uploads')
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`

/** Application tables in `public`, ordered parents-first by foreign keys (stable within a level). */
async function orderedTables(client: Client): Promise<Array<{ name: string; columns: string[] }>> {
  const tables = (
    await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    )
  ).rows.map((r) => r.table_name)
  const edges = (
    await client.query<{ child: string; parent: string }>(
      `select distinct c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
       from pg_constraint c join pg_namespace n on n.oid = c.connamespace
       where c.contype = 'f' and n.nspname = 'public' and c.conrelid <> c.confrelid`,
    )
  ).rows.map((r) => ({
    child: r.child.replace(/^public\./, '').replaceAll('"', ''),
    parent: r.parent.replace(/^public\./, '').replaceAll('"', ''),
  }))
  const remaining = new Set(tables)
  const ordered: string[] = []
  while (remaining.size > 0) {
    const ready = [...remaining].filter(
      (t) => !edges.some((e) => e.child === t && remaining.has(e.parent)),
    )
    if (ready.length === 0)
      throw new Error(`circular foreign keys among tables: ${[...remaining].join(', ')}`)
    for (const t of ready.sort()) {
      ordered.push(t)
      remaining.delete(t)
    }
  }
  const out: Array<{ name: string; columns: string[] }> = []
  for (const name of ordered) {
    const columns = (
      await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`,
        [name],
      )
    ).rows.map((r) => r.column_name)
    out.push({ name, columns })
  }
  return out
}

/** Creates `<DATA_DIR>/backups/<timestamp>/` with manifest.json, db/<table>.csv and uploads/. */
export async function createBackup(options: BackupOptions): Promise<BackupSummary> {
  const log = options.log ?? (() => {})
  const now = options.now ?? new Date()
  const name = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const dir = path.join(backupsDir(options.dataDir), name)
  if (fs.existsSync(dir)) throw new Error(`backup ${name} already exists`)
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true })

  try {
    const { tables, postgresVersion, schemaTag } = await withClient(
      options.databaseUrl,
      async (client) => {
        // One snapshot for every table so the dump is consistent.
        await client.query('begin isolation level repeatable read read only')
        const version =
          (await client.query<{ version: string }>('select version()')).rows[0]?.version ??
          'unknown'
        let tag: string | null
        try {
          tag =
            (
              await client.query<{ hash: string }>(
                'select hash from drizzle.__drizzle_migrations order by created_at desc limit 1',
              )
            ).rows[0]?.hash ?? null
        } catch {
          tag = null
        }
        const dumps: TableDump[] = []
        for (const table of await orderedTables(client)) {
          const file = `db/${table.name}.csv`
          const target = path.join(dir, file)
          const columns = table.columns.map(ident).join(', ')
          const stream = client.query(
            copyTo(
              `copy (select ${columns} from ${ident(table.name)}) to stdout with (format csv, header true)`,
            ),
          )
          await pipeline(stream, fs.createWriteStream(target))
          const rows = Number(
            (
              await client.query<{ n: string }>(
                `select count(*)::text as n from ${ident(table.name)}`,
              )
            ).rows[0]?.n ?? 0,
          )
          dumps.push({
            name: table.name,
            columns: table.columns,
            rows,
            file,
            size: fs.statSync(target).size,
            sha256: sha256File(target),
          })
        }
        await client.query('commit')
        return { tables: dumps, postgresVersion: version, schemaTag: tag }
      },
    )
    log(`exported ${tables.length} tables`)

    // Uploads are copied after the data: files are immutable and content-addressed, so anything
    // the data references already exists, and orphan cleanup waits longer than a backup takes.
    const files: BackupManifest['files'] = []
    const source = uploadsDir(options.dataDir)
    for (const rel of walk(source)) {
      const from = path.join(source, rel)
      const to = path.join(dir, 'uploads', rel)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
      files.push({ path: rel, size: fs.statSync(to).size, sha256: sha256File(to) })
    }
    log(`copied ${files.length} uploaded file(s)`)

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: now.toISOString(),
      appVersion: APP_VERSION,
      postgresVersion,
      schemaTag,
      counts: Object.fromEntries(tables.map((t) => [t.name, t.rows])),
      tables,
      files,
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    log(`backup ${name} written to ${dir}`)
    return {
      name,
      dir,
      manifest,
      totalBytes: tables.reduce((n, t) => n + t.size, 0) + files.reduce((n, f) => n + f.size, 0),
    }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

export type VerifyResult = { ok: boolean; problems: string[]; manifest: BackupManifest | null }

/** Checks the manifest, every table file's checksum and every uploaded file's presence and checksum. */
export function verifyBackup(dir: string): VerifyResult {
  const problems: string[] = []
  const manifestPath = path.join(dir, 'manifest.json')
  if (!fs.existsSync(manifestPath))
    return { ok: false, problems: ['manifest.json is missing'], manifest: null }
  let manifest: BackupManifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest
  } catch {
    return { ok: false, problems: ['manifest.json is not valid JSON'], manifest: null }
  }
  if (manifest.format !== BACKUP_FORMAT || manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    problems.push(
      `unsupported backup format ${String(manifest.format)}@${String(manifest.formatVersion)}`,
    )
  }
  if (!Array.isArray(manifest.tables) || manifest.tables.length === 0) {
    problems.push('manifest lists no tables')
  }
  if (!Array.isArray(manifest.files)) problems.push('manifest lists no files array')
  for (const t of manifest.tables ?? []) {
    const file = path.join(dir, t.file)
    if (!fs.existsSync(file)) problems.push(`table file missing: ${t.file}`)
    else if (sha256File(file) !== t.sha256) problems.push(`table file checksum mismatch: ${t.file}`)
  }
  for (const f of manifest.files ?? []) {
    const file = path.join(dir, 'uploads', f.path)
    if (!fs.existsSync(file)) problems.push(`uploaded file missing: ${f.path}`)
    else if (sha256File(file) !== f.sha256)
      problems.push(`uploaded file checksum mismatch: ${f.path}`)
  }
  return { ok: problems.length === 0, problems, manifest }
}

export type RestoreOptions = BackupOptions & { dir: string }

/**
 * Restores a backup into the target database and data directory:
 * verify → maintenance marker → migrations → truncate → COPY FROM in order → swap uploads → verify.
 * The caller points DATABASE_URL at the target database (existing or empty).
 */
export async function restoreBackup(
  options: RestoreOptions,
): Promise<{ manifest: BackupManifest; restoredFiles: number; restoredRows: number }> {
  const log = options.log ?? (() => {})
  const verified = verifyBackup(options.dir)
  if (!verified.ok || !verified.manifest)
    throw new Error(`backup failed verification: ${verified.problems.join('; ')}`)
  const manifest = verified.manifest

  const marker = maintenanceMarkerPath(options.dataDir)
  fs.mkdirSync(path.dirname(marker), { recursive: true })
  fs.writeFileSync(
    marker,
    JSON.stringify({
      reason: 'restore',
      startedAt: new Date().toISOString(),
      backup: path.basename(options.dir),
    }),
  )
  try {
    // Give a running server time to notice the marker and drain in-flight requests.
    await new Promise((resolve) => setTimeout(resolve, 1500))

    log('bringing the schema to the current version')
    const pool = new Pool({ connectionString: options.databaseUrl, max: 2 })
    try {
      await runMigrations(pool)
    } finally {
      await pool.end()
    }

    let restoredRows = 0
    await withClient(options.databaseUrl, async (client) => {
      const present = await orderedTables(client)
      const presentByName = new Map(present.map((t) => [t.name, new Set(t.columns)]))
      for (const t of manifest.tables) {
        const columns = presentByName.get(t.name)
        if (!columns)
          throw new Error(
            `table "${t.name}" from the backup does not exist in this version; upgrade the backup first`,
          )
        const missing = t.columns.filter((c) => !columns.has(c))
        if (missing.length > 0)
          throw new Error(
            `table "${t.name}" lacks columns ${missing.join(', ')} present in the backup; this version is older than the backup`,
          )
      }
      await client.query('begin')
      try {
        const all = present.map((t) => ident(t.name)).join(', ')
        await client.query(`truncate ${all} restart identity cascade`)
        for (const t of manifest.tables) {
          const columns = t.columns.map(ident).join(', ')
          const stream = client.query(
            copyFrom(
              `copy ${ident(t.name)} (${columns}) from stdin with (format csv, header true)`,
            ),
          )
          await pipeline(fs.createReadStream(path.join(options.dir, t.file)), stream)
          restoredRows += t.rows
        }
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      }
    })
    log(`restored ${restoredRows} rows across ${manifest.tables.length} tables`)

    // Uploads: unpack to a staging directory, then swap atomically.
    const target = uploadsDir(options.dataDir)
    const staging = `${target}.restoring`
    const previous = `${target}.previous`
    fs.rmSync(staging, { recursive: true, force: true })
    fs.mkdirSync(staging, { recursive: true })
    for (const f of manifest.files) {
      const to = path.join(staging, f.path)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(path.join(options.dir, 'uploads', f.path), to)
    }
    fs.rmSync(previous, { recursive: true, force: true })
    if (fs.existsSync(target)) fs.renameSync(target, previous)
    fs.renameSync(staging, target)
    fs.rmSync(previous, { recursive: true, force: true })
    for (const f of manifest.files) {
      if (!fs.existsSync(path.join(target, f.path)))
        throw new Error(`restored file missing: ${f.path}`)
    }
    log(`restored ${manifest.files.length} uploaded file(s)`)
    return { manifest, restoredFiles: manifest.files.length, restoredRows }
  } finally {
    fs.rmSync(marker, { force: true })
  }
}

export function listBackups(dataDir: string): BackupSummary[] {
  const root = backupsDir(dataDir)
  if (!fs.existsSync(root)) return []
  const out: BackupSummary[] = []
  for (const name of fs.readdirSync(root).sort().reverse()) {
    const dir = path.join(root, name)
    const manifestPath = path.join(dir, 'manifest.json')
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest
      const totalBytes =
        (manifest.tables ?? []).reduce((n, t) => n + t.size, 0) +
        (manifest.files ?? []).reduce((n, f) => n + f.size, 0)
      out.push({ name, dir, manifest, totalBytes })
    } catch {
      /* skip unreadable manifests */
    }
  }
  return out
}

/** Keeps the newest `keep` backups and deletes the rest. Returns the removed names. */
export function pruneBackups(dataDir: string, keep: number): string[] {
  const removed: string[] = []
  for (const backup of listBackups(dataDir).slice(Math.max(0, keep))) {
    fs.rmSync(backup.dir, { recursive: true, force: true })
    removed.push(backup.name)
  }
  return removed
}
