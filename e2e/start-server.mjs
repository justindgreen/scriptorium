/**
 * Launches the production-style server for Playwright on a fresh data directory.
 * Lives in its own process so the wipe happens exactly once (the Playwright config is evaluated
 * again inside every worker). Set PW_REUSE_DATA=1 to keep the previous run's data.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.env.DATA_DIR
if (dataDir && !process.env.PW_REUSE_DATA) {
  fs.rmSync(dataDir, { recursive: true, force: true })
}

const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.join(rootDir, 'apps', 'server'),
  stdio: 'inherit',
  env: process.env,
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code) => process.exit(code ?? 0))
