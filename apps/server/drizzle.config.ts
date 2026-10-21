import { defineConfig } from 'drizzle-kit'

/** Used by `pnpm -F @scriptorium/server db:generate` to emit SQL migrations into ./drizzle. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
})
