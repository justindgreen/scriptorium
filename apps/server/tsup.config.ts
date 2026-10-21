import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Workspace packages are TypeScript sources; bundle them into the server build.
  noExternal: [/^@scriptorium\//],
})
