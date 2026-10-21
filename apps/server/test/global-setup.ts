/**
 * Vitest global setup for the server package: one PostgreSQL server for the whole run.
 * - With DATABASE_URL set (CI uses the postgres:17 service), tests create databases on that server.
 * - Otherwise a throwaway embedded PostgreSQL 17 cluster is started (spike S1).
 * Each test file then creates its own database via test/helpers/database.ts.
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { TestProject } from 'vitest/node'
import { startEmbeddedPostgres } from '../src/db/embedded.js'

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string
  }
}

export default async function setup(project: TestProject) {
  const external = process.env['DATABASE_URL']
  if (external) {
    project.provide('pgAdminUrl', external)
    return
  }

  const port = await freePort()
  const dataDir = path.resolve('.data', `test-pg-${process.pid}`)
  fs.rmSync(dataDir, { recursive: true, force: true })
  const embedded = await startEmbeddedPostgres({
    dataDir,
    port,
    persistent: false,
    database: 'postgres',
    onError: (m) => console.error('[test-pg]', m),
  })
  project.provide('pgAdminUrl', embedded.adminUrl)

  return async () => {
    await embedded.stop()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}
