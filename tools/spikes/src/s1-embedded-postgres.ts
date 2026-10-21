/**
 * Spike S1: can this workstation run an embedded PostgreSQL 17 for development and tests?
 * Verifies: initdb/start/stop as the current user, extensions (pg_trgm, citext), tsvector search,
 * and timings. Prints evidence for docs/DECISIONS.md.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import { Client } from 'pg'

const dataDir = path.resolve('.data/spike-pg')
const port = 54329

fs.rmSync(dataDir, { recursive: true, force: true })
console.log('os user:', os.userInfo().username, '| platform:', process.platform, process.arch)

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'scriptorium',
  password: 'scriptorium',
  port,
  persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: (message: unknown) => console.error('[pg]', String(message).trim()),
})

const t0 = Date.now()
await pg.initialise()
console.log('initdb ms:', Date.now() - t0)

const t1 = Date.now()
await pg.start()
console.log('start ms:', Date.now() - t1)

await pg.createDatabase('spike')
const client = new Client({
  host: 'localhost',
  port,
  user: 'scriptorium',
  password: 'scriptorium',
  database: 'spike',
})
await client.connect()

const version = (await client.query<{ version: string }>('select version()')).rows[0]?.version
console.log('version:', version)

await client.query('create extension if not exists pg_trgm')
await client.query('create extension if not exists citext')
await client.query(`
  create table t (
    id serial primary key,
    name text,
    body text,
    sv tsvector generated always as (
      setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(body, '')), 'C')
    ) stored
  )`)
await client.query('create index on t using gin (sv)')
await client.query('create index on t using gin (name gin_trgm_ops)')
await client.query(`insert into t (name, body) values
  ('Fireball', 'A bright streak flashes from your pointing finger'),
  ('Fire Bolt', 'You hurl a mote of fire at a creature'),
  ('Cure Wounds', 'A creature you touch regains hit points')`)

const trgm = await client.query(
  `select name, round(similarity(name, 'firebal')::numeric, 2) as s from t order by s desc`,
)
console.log('trigram:', JSON.stringify(trgm.rows))
const fts = await client.query(
  `select name from t where sv @@ plainto_tsquery('english', 'fire') order by ts_rank(sv, plainto_tsquery('english', 'fire')) desc`,
)
console.log('tsvector:', JSON.stringify(fts.rows))
const ci = await client.query(`select 'Fire'::citext = 'fire'::citext as ci`)
console.log('citext:', JSON.stringify(ci.rows))

// Concurrency: a second connection sees committed data and advisory locks work.
const client2 = new Client({
  host: 'localhost',
  port,
  user: 'scriptorium',
  password: 'scriptorium',
  database: 'spike',
})
await client2.connect()
const lock1 = await client.query<{ ok: boolean }>('select pg_try_advisory_lock(42) as ok')
const lock2 = await client2.query<{ ok: boolean }>('select pg_try_advisory_lock(42) as ok')
console.log(
  'advisory lock first:',
  lock1.rows[0]?.ok,
  '| second (expected false):',
  lock2.rows[0]?.ok,
)
await client2.end()
await client.end()

const t2 = Date.now()
await pg.stop()
console.log('stop ms:', Date.now() - t2)
fs.rmSync(dataDir, { recursive: true, force: true })
console.log('S1 OK')
