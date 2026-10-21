import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useRouter,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { ErrorState, LoadingState } from '@/components/states'
import { AppShell } from '@/layout/AppShell'
import { AuthLayout } from '@/layout/AuthLayout'
import { loadSession, loadStatus } from '@/lib/session'
import { errorMessage } from '@/lib/trpc'
import { AdminAuditPage } from '@/pages/AdminAuditPage'
import { AdminInvitesPage } from '@/pages/AdminInvitesPage'
import { AdminSettingsPage } from '@/pages/AdminSettingsPage'
import { AdminUsersPage } from '@/pages/AdminUsersPage'
import { HomePage } from '@/pages/HomePage'
import { LicensesPage } from '@/pages/LicensesPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { SetupPage } from '@/pages/SetupPage'
import { RootDocument } from '@/RootDocument'

const rootRoute = createRootRoute({ component: RootDocument })

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

// --- Authenticated application frame
const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireSession,
  component: AppShell,
})

const indexRoute = createRoute({ getParentRoute: () => appLayout, path: '/', component: HomePage })
const adminUsersRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/admin/users',
  beforeLoad: requireAdmin,
  component: AdminUsersPage,
})
const adminInvitesRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/admin/invites',
  beforeLoad: requireAdmin,
  component: AdminInvitesPage,
})
const adminAuditRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/admin/audit',
  beforeLoad: requireAdmin,
  component: AdminAuditPage,
})
const adminSettingsRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/admin/settings',
  beforeLoad: requireAdmin,
  component: AdminSettingsPage,
})

// --- Public frame
const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  component: AuthLayout,
})

const setupRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/setup',
  beforeLoad: async () => {
    const status = await loadStatus()
    if (status.setupComplete) throw redirect({ to: '/' })
    return { status }
  },
  component: SetupPage,
})
const loginRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/login',
  beforeLoad: requireAnonymous,
  component: LoginPage,
})
const registerRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/register',
  validateSearch: (search: Record<string, unknown>) => ({
    invite: typeof search['invite'] === 'string' ? search['invite'] : '',
  }),
  beforeLoad: requireAnonymous,
  component: RegisterPage,
})

const licensesRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/licenses',
  component: LicensesPage,
})

const routeTree = rootRoute.addChildren([
  appLayout.addChildren([
    indexRoute,
    adminUsersRoute,
    adminInvitesRoute,
    adminAuditRoute,
    adminSettingsRoute,
  ]),
  authLayout.addChildren([setupRoute, loginRoute, registerRoute, licensesRoute]),
])

function RouteError(props: ErrorComponentProps) {
  const router = useRouter()
  return (
    <div className="mx-auto max-w-xl py-10">
      <ErrorState
        title="This page could not load"
        message={errorMessage(props.error)}
        onRetry={() => void router.invalidate()}
      />
    </div>
  )
}

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingMs: 300,
  defaultPendingComponent: () => <LoadingState className="mx-auto max-w-3xl py-10" />,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: NotFoundPage,
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
