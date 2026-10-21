import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { RootLayout } from './layout/RootLayout.js'
import { loadSession, loadStatus } from './lib/session.js'
import { AdminInvitesPage } from './pages/AdminInvitesPage.js'
import { AdminUsersPage } from './pages/AdminUsersPage.js'
import { HomePage } from './pages/HomePage.js'
import { LoginPage } from './pages/LoginPage.js'
import { NotFoundPage } from './pages/NotFoundPage.js'
import { RegisterPage } from './pages/RegisterPage.js'
import { SetupPage } from './pages/SetupPage.js'

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
})

/** Until the first administrator exists, every page leads to the setup wizard. */
async function requireSetupComplete() {
  const status = await loadStatus()
  if (!status.setupComplete) throw redirect({ to: '/setup' })
  return { status }
}

async function requireSession() {
  const { status } = await requireSetupComplete()
  const me = await loadSession()
  if (!me) throw redirect({ to: '/login' })
  return { status, me }
}

async function requireAdmin() {
  const ctx = await requireSession()
  if (ctx.me.role !== 'admin') throw redirect({ to: '/' })
  return ctx
}

async function requireAnonymous() {
  const { status } = await requireSetupComplete()
  const me = await loadSession()
  if (me) throw redirect({ to: '/' })
  return { status }
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: requireSession,
  component: HomePage,
})

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: async () => {
    const status = await loadStatus()
    if (status.setupComplete) throw redirect({ to: '/' })
    return { status }
  },
  component: SetupPage,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: requireAnonymous,
  component: LoginPage,
})

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  validateSearch: (search: Record<string, unknown>) => ({
    invite: typeof search['invite'] === 'string' ? search['invite'] : '',
  }),
  beforeLoad: requireAnonymous,
  component: RegisterPage,
})

const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/users',
  beforeLoad: requireAdmin,
  component: AdminUsersPage,
})

const adminInvitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/invites',
  beforeLoad: requireAdmin,
  component: AdminInvitesPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  loginRoute,
  registerRoute,
  adminUsersRoute,
  adminInvitesRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
