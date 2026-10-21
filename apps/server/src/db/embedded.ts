import fs from 'node:fs'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import { Client } from 'pg'

export type EmbeddedOptions = {
  /** Directory holding the cluster. Created on first use. */
  dataDir: string
  port: number
  /** Keep data between runs (development) or delete it on stop (tests). */
  persistent: boolean
  /** Name of the application database to ensure exists. */
  database: string
  onError?: (message: string) => void
}

export type EmbeddedHandle = { url: string; adminUrl: string; stop: () => Promise<void> }

const USER = 'scriptorium'
const PASSWORD = 'scriptorium'

/**
 * Starts an embedded PostgreSQL 17 cluster (spike S1). Used when DATABASE_URL is unset outside
 * production: development data lives under DATA_DIR/pg; tests use throwaway clusters.
 */
export async function startEmbeddedPostgres(options: EmbeddedOptions): Promise<EmbeddedHandle> {
  const dataDir = path.resolve(options.dataDir)
  fs.mkdirSync(path.dirname(dataDir), { recursive: true })
  await reclaimDataDir(dataDir)

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: options.port,
    persistent: options.persistent,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (message: unknown) => options.onError?.(String(message).trim()),
  })

  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    await pg.initialise()
  }
  await pg.start()

  const adminUrl = `postgres://${USER}:${PASSWORD}@localhost:${options.port}/postgres`
  await ensureDatabase(adminUrl, options.database)

  return {
    url: `postgres://${USER}:${PASSWORD}@localhost:${options.port}/${options.database}`,
    adminUrl,
    stop: () => pg.stop(),
  }
}

/** Creates the database if it does not exist (CREATE DATABASE cannot run inside a transaction). */
export async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl })
  await client.connect()
  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [name])
    if (existing.rowCount === 0) {
      await client.query(`create database "${name.replaceAll('"', '""')}"`)
    }
  } finally {
    await client.end()
  }
}

/**
 * A previous run that was force-killed can leave the cluster running without its parent process,
 * or leave a stale postmaster.pid behind. Both block the next start. This is development and test
 * tooling only: the orphaned server is ours, so it is stopped and the pid file removed.
 */
async function reclaimDataDir(dataDir: string): Promise<void> {
  const pidFile = path.join(dataDir, 'postmaster.pid')
  if (!fs.existsSync(pidFile)) return
  const [pidText] = fs.readFileSync(pidFile, 'utf8').split('\n')
  const pid = Number(pidText)
  if (Number.isFinite(pid) && pid > 0 && isProcessAlive(pid)) {
    try {
      process.kill(pid)
    } catch {
      // Not ours to stop (permissions); let pg_ctl report the conflict.
      return
    }
    const deadline = Date.now() + 10_000
    while (isProcessAlive(pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  fs.rmSync(pidFile, { force: true })
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
