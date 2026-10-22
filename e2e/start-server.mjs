/**
 * Launches the production-style server for Playwright on a fresh data directory.
 * Lives in its own process so the wipe happens exactly once (the Playwright config is evaluated
 * again inside every worker). Set PW_REUSE_DATA=1 to keep the previous run's data.
 *
 * Restart on request: a test that must prove persistence across a restart creates
 * `<DATA_DIR>/restart.request`; the supervisor stops the server, removes the file and starts the
 * server again on the same data directory. Nothing in the application knows about this.
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
const restartRequest = dataDir ? path.join(dataDir, 'restart.request') : null

let child = null
let restarting = false
let stopping = false

function start() {
  child = spawn(process.execPath, ['dist/main.js'], {
    cwd: path.join(rootDir, 'apps', 'server'),
    stdio: 'inherit',
    env: process.env,
  })
  child.on('exit', (code) => {
    if (restarting) {
      restarting = false
      start()
      return
    }
    process.exit(code ?? 0)
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true
    child?.kill(signal)
  })
}

if (restartRequest) {
  setInterval(() => {
    if (stopping || restarting || !fs.existsSync(restartRequest)) return
    fs.rmSync(restartRequest, { force: true })
    restarting = true
    child?.kill('SIGTERM')
  }, 500).unref()
}

start()
