import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Config } from './config.js'

/**
 * Returns the application secret. In production it must come from APP_SECRET (validated by the
 * config). Elsewhere a random secret is generated once and kept in DATA_DIR so sessions survive
 * restarts of the development server.
 */
export function resolveAppSecret(config: Config): string {
  if (config.APP_SECRET) return config.APP_SECRET
  if (config.NODE_ENV === 'production') {
    throw new Error('APP_SECRET is required in production')
  }
  const file = path.join(config.DATA_DIR, 'app-secret')
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing.length >= 32) return existing
  }
  fs.mkdirSync(config.DATA_DIR, { recursive: true })
  const secret = randomBytes(48).toString('base64url')
  fs.writeFileSync(file, secret, { mode: 0o600 })
  return secret
}
