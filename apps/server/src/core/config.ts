import { z } from 'zod'

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Persistent data directory (uploads, backups, local dev database). Mapped to /data in Docker. */
    DATA_DIR: z.string().default('./.data'),
    /** Directory of the built web app to serve. When unset, the server serves the API only. */
    WEB_DIST_DIR: z.string().optional(),
    /** PostgreSQL connection string. Required in production; otherwise an embedded server is started. */
    DATABASE_URL: z.string().url().optional(),
    /** Port for the embedded development database (used only when DATABASE_URL is unset). */
    DEV_PG_PORT: z.coerce.number().int().positive().max(65535).default(54320),
    /** Secret for session cookies and tokens. Required in production (at least 32 characters). */
    APP_SECRET: z.string().min(32).optional(),
    /** The URL users open in their browser. Used for cookies, CSRF origin checks and invite links. */
    PUBLIC_URL: z.string().url().default('http://localhost:3000'),
    /** Extra origins allowed to call the API (comma separated), e.g. the Vite dev server. */
    TRUSTED_ORIGINS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    /** Directory with bundled rulesets and content packages. Defaults to the repository/image content dir. */
    CONTENT_DIR: z.string().optional(),
    /** Import bundled content at start (idempotent). */
    SEED_CONTENT: booleanFromEnv.default(true),
    /** Trust X-Forwarded-* headers from a reverse proxy. */
    TRUST_PROXY: booleanFromEnv.default(false),
    /** Mark cookies Secure. "auto" derives it from PUBLIC_URL's scheme. */
    COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV === 'production') {
      if (!cfg.DATABASE_URL) {
        ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'required in production' })
      }
      if (!cfg.APP_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['APP_SECRET'], message: 'required in production' })
      }
    }
  })
  .transform((cfg) => ({
    ...cfg,
    cookieSecure:
      cfg.COOKIE_SECURE === 'auto'
        ? cfg.PUBLIC_URL.startsWith('https://')
        : cfg.COOKIE_SECURE === 'true',
    trustedOrigins: Array.from(
      new Set([
        cfg.PUBLIC_URL,
        ...cfg.TRUSTED_ORIGINS,
        ...(cfg.NODE_ENV === 'development'
          ? ['http://localhost:5173', 'http://127.0.0.1:5173']
          : []),
      ]),
    ),
  }))

export type Config = z.infer<typeof configSchema>

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** Parses configuration from environment variables, failing fast with a readable message. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env)
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`)
  }
  return result.data
}
