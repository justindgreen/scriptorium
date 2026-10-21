/**
 * Spike S3: Better Auth as the authentication layer.
 * Criteria (ADR-0005): offline username/password with no email delivery, Drizzle adapter on our own
 * schema, DB-backed cookie sessions, admin/role plugin, rate limiting, invite-gated sign-up,
 * acceptable dependency footprint. Runs against the embedded PostgreSQL from spike S1.
 */
import fs from 'node:fs'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { username, admin } from 'better-auth/plugins'
import { createAuthMiddleware, APIError } from 'better-auth/api'

// ---------- Our own Drizzle schema with the columns Better Auth (core + username + admin) expects.
const user = pgTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  username: text('username').unique(),
  displayUsername: text('display_username'),
  role: text('role'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
})
const session = pgTable('auth_session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  impersonatedBy: text('impersonated_by'),
})
const account = pgTable('auth_account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})
const verification = pgTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
})

// ---------- Database
const dataDir = path.resolve('.data/spike-pg-auth')
const port = 54330
fs.rmSync(dataDir, { recursive: true, force: true })
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'scriptorium',
  password: 'scriptorium',
  port,
  persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: (m: unknown) => console.error('[pg]', String(m).trim()),
})
await pg.initialise()
await pg.start()
await pg.createDatabase('auth')
const pool = new Pool({
  host: 'localhost',
  port,
  user: 'scriptorium',
  password: 'scriptorium',
  database: 'auth',
})
const db = drizzle(pool, { schema: { user, session, account, verification } })
await db.execute(sql`create table auth_user (
  id text primary key, name text not null, email text not null unique, email_verified boolean not null default false,
  image text, created_at timestamp not null default now(), updated_at timestamp not null default now(),
  username text unique, display_username text, role text, banned boolean default false, ban_reason text, ban_expires timestamp)`)
await db.execute(sql`create table auth_session (
  id text primary key, expires_at timestamp not null, token text not null unique, created_at timestamp not null,
  updated_at timestamp not null, ip_address text, user_agent text,
  user_id text not null references auth_user(id) on delete cascade, impersonated_by text)`)
await db.execute(sql`create table auth_account (
  id text primary key, account_id text not null, provider_id text not null,
  user_id text not null references auth_user(id) on delete cascade, access_token text, refresh_token text, id_token text,
  access_token_expires_at timestamp, refresh_token_expires_at timestamp, scope text, password text,
  created_at timestamp not null, updated_at timestamp not null)`)
await db.execute(sql`create table auth_verification (
  id text primary key, identifier text not null, value text not null, expires_at timestamp not null,
  created_at timestamp, updated_at timestamp)`)

// ---------- Invite gating (our rule): sign-up is allowed only during setup (no users yet) or with a valid invite.
const validInvites = new Set(['INVITE-OK'])
async function userCount() {
  const rows = await db.execute<{ n: string }>(sql`select count(*)::text as n from auth_user`)
  return Number(rows.rows[0]?.n ?? 0)
}

const auth = betterAuth({
  baseURL: 'http://localhost:3000',
  basePath: '/api/auth',
  secret: 'spike-secret-at-least-32-characters-long-000',
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 10, requireEmailVerification: false },
  plugins: [username(), admin()],
  rateLimit: { enabled: true, window: 60, max: 3 },
  session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
  advanced: { cookiePrefix: 'scriptorium', useSecureCookies: false },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-up/email') {
        const body = (ctx.body ?? {}) as { inviteCode?: string }
        const setupPending = (await userCount()) === 0
        if (!setupPending && !(body.inviteCode && validInvites.has(body.inviteCode))) {
          throw new APIError('FORBIDDEN', { message: 'An invite code is required to register.' })
        }
      }
    }),
  },
})

const results: Record<string, unknown> = {}

// 1. First user signs up during setup (no invite needed). Email is synthetic: Better Auth requires one.
const first = await auth.api.signUpEmail({
  body: {
    name: 'Dungeon Master',
    email: 'dm@scriptorium.local',
    password: 'correct-horse-battery',
    username: 'gamemaster',
  },
})
results.firstUserCreated = Boolean(first.user?.id)
await db.execute(sql`update auth_user set role = 'admin' where id = ${first.user.id}`)

// 2. Second sign-up without invite is refused; with invite it succeeds.
try {
  await auth.api.signUpEmail({
    body: {
      name: 'Sneaky',
      email: 'sneaky@scriptorium.local',
      password: 'correct-horse-battery',
      username: 'sneaky',
    },
  })
  results.signUpWithoutInvite = 'ALLOWED (bad)'
} catch (e) {
  results.signUpWithoutInvite = e instanceof APIError ? `refused ${e.status}` : `error ${String(e)}`
}
const invited = await auth.api.signUpEmail({
  body: {
    name: 'Player One',
    email: 'p1@scriptorium.local',
    password: 'correct-horse-battery',
    username: 'player1',
    inviteCode: 'INVITE-OK',
  } as never,
})
results.signUpWithInvite = Boolean(invited.user?.id)

// 3. Username sign-in returns a session cookie; the session is stored in the DB.
const signIn = await auth.api.signInUsername({
  body: { username: 'gamemaster', password: 'correct-horse-battery' },
  asResponse: true,
})
const setCookie = signIn.headers.get('set-cookie') ?? ''
results.signInStatus = signIn.status
results.cookieName = setCookie.split('=')[0]
results.cookieFlags = {
  httpOnly: /httponly/i.test(setCookie),
  sameSite: /samesite=lax/i.test(setCookie),
  path: /path=\//i.test(setCookie),
}
const cookie = setCookie.split(';')[0] ?? ''
const sessionRows = await db.execute<{ n: string }>(
  sql`select count(*)::text as n from auth_session`,
)
results.sessionsInDb = Number(sessionRows.rows[0]?.n)

const me = await auth.api.getSession({ headers: new Headers({ cookie }) })
results.sessionUser = me?.user.username
results.sessionRole = (me?.user as { role?: string } | undefined)?.role

// 4. Wrong password is rejected.
try {
  await auth.api.signInUsername({
    body: { username: 'gamemaster', password: 'wrong-password-here' },
  })
  results.wrongPassword = 'ACCEPTED (bad)'
} catch (e) {
  results.wrongPassword = e instanceof APIError ? `refused ${e.status}` : `error ${String(e)}`
}

// 5. Admin plugin: the admin creates a user with a role and lists users.
const created = await auth.api.createUser({
  headers: new Headers({ cookie }),
  body: {
    email: 'p2@scriptorium.local',
    password: 'correct-horse-battery',
    name: 'Player Two',
    role: 'user',
    data: { username: 'player2' },
  },
})
results.adminCreatedUser = created.user.id ? 'yes' : 'no'
const list = await auth.api.listUsers({ headers: new Headers({ cookie }), query: { limit: 10 } })
results.userCount = list.total
// A non-admin cannot use the admin API.
const p1 = await auth.api.signInUsername({
  body: { username: 'player1', password: 'correct-horse-battery' },
  asResponse: true,
})
const p1Cookie = (p1.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
try {
  await auth.api.listUsers({ headers: new Headers({ cookie: p1Cookie }), query: { limit: 10 } })
  results.playerListUsers = 'ALLOWED (bad)'
} catch (e) {
  results.playerListUsers = e instanceof APIError ? `refused ${e.status}` : `error ${String(e)}`
}

// 6. Sign-out revokes the DB session.
await auth.api.signOut({ headers: new Headers({ cookie }) })
results.sessionAfterSignOut =
  (await auth.api.getSession({ headers: new Headers({ cookie }) })) === null
    ? 'gone'
    : 'still valid (bad)'

// 7. Rate limiting through the HTTP handler (max 3 per window from one IP).
const statuses: number[] = []
for (let i = 0; i < 5; i += 1) {
  const res = await auth.handler(
    new Request('http://localhost:3000/api/auth/sign-in/username', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.7' },
      body: JSON.stringify({ username: 'gamemaster', password: 'wrong-password-here' }),
    }),
  )
  statuses.push(res.status)
}
results.rateLimitStatuses = statuses

// 8. Password hash algorithm in storage.
const stored = await db.execute<{ password: string }>(
  sql`select password from auth_account limit 1`,
)
results.passwordHashSample = (stored.rows[0]?.password ?? '').slice(0, 24) + '…'

console.log(JSON.stringify(results, null, 2))
await pool.end()
await pg.stop()
fs.rmSync(dataDir, { recursive: true, force: true })

const ok =
  results.firstUserCreated === true &&
  String(results.signUpWithoutInvite).startsWith('refused') &&
  results.signUpWithInvite === true &&
  results.signInStatus === 200 &&
  Number(results.sessionsInDb) >= 1 &&
  results.sessionUser === 'gamemaster' &&
  results.sessionRole === 'admin' &&
  String(results.wrongPassword).startsWith('refused') &&
  results.adminCreatedUser === 'yes' &&
  String(results.playerListUsers).startsWith('refused') &&
  results.sessionAfterSignOut === 'gone' &&
  statuses.includes(429)
if (!ok) throw new Error('S3 assertions failed')
console.log('S3 OK')
