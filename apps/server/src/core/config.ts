import { z } from 'zod'

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Persistent data directory (uploads, backups, local dev database). Mapped to /data in Docker. */
  DATA_DIR: z.string().default('./.data'),
  /** Directory of the built web app to serve. When unset, the server serves the API only. */
  WEB_DIST_DIR: z.string().optional(),
})

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
