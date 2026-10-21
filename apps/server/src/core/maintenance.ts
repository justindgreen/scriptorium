import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'

/**
 * Maintenance mode is a marker file in DATA_DIR so a restore run from the CLI (another process)
 * can pause a running server. The server re-checks the marker at most once per second.
 */
export function maintenanceMarkerPath(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'maintenance.lock')
}

export function createMaintenanceGate(dataDir: string, intervalMs = 1000) {
  const marker = maintenanceMarkerPath(dataDir)
  let cached = false
  let checkedAt = 0
  return {
    isActive(): boolean {
      const now = Date.now()
      if (now - checkedAt > intervalMs) {
        cached = fs.existsSync(marker)
        checkedAt = now
      }
      return cached
    },
    /** Blocks everything except health endpoints with 503 while the marker exists. */
    register(app: FastifyInstance) {
      app.addHook('onRequest', async (request, reply) => {
        if (request.url.startsWith('/healthz') || request.url.startsWith('/readyz')) return
        if (this.isActive()) {
          return reply
            .code(503)
            .header('retry-after', '10')
            .send({ error: 'Maintenance in progress. Try again shortly.' })
        }
      })
    },
  }
}

export type MaintenanceGate = ReturnType<typeof createMaintenanceGate>
