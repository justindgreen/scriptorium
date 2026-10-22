import { router } from './core/trpc.js'
import { adminRouter } from './modules/admin/router.js'
import { charactersRouter } from './modules/characters/router.js'
import { contentRouter } from './modules/content/router.js'
import { homebrewRouter } from './modules/homebrew/router.js'
import { meRouter } from './modules/me/router.js'
import { setupRouter } from './modules/setup/router.js'
import { systemRouter } from './modules/system/router.js'

export const appRouter = router({
  system: systemRouter,
  setup: setupRouter,
  me: meRouter,
  admin: adminRouter,
  content: contentRouter,
  characters: charactersRouter,
  homebrew: homebrewRouter,
})

export type AppRouter = typeof appRouter
