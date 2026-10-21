import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { signOutEverywhere } from '../lib/auth-client.js'
import { resetSessionCache } from '../lib/session.js'
import { isTrpcError, trpc } from '../lib/trpc.js'

/**
 * Foundation layout (M1.3): header with instance name, navigation for the signed-in user and
 * sign-out. The design system and full application shell replace the styling in M1.4.
 */
export function RootLayout() {
  const navigate = useNavigate()
  const status = useQuery(trpc.system.status.queryOptions())
  const me = useQuery({
    ...trpc.me.get.queryOptions(),
    enabled: status.data?.setupComplete === true,
    retry: false,
    throwOnError: (error) => !isTrpcError(error, 'UNAUTHORIZED'),
  })
  const user = me.data ?? null

  async function onSignOut() {
    await signOutEverywhere()
    await resetSessionCache()
    await navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            {status.data?.instanceName ?? 'Scriptorium'}
          </Link>
          {user ? (
            <nav aria-label="Primary" className="flex flex-wrap items-center gap-4 text-sm">
              <Link to="/" activeProps={{ 'aria-current': 'page', className: 'font-semibold' }}>
                Home
              </Link>
              {user.role === 'admin' && (
                <>
                  <Link
                    to="/admin/users"
                    activeProps={{ 'aria-current': 'page', className: 'font-semibold' }}
                  >
                    Users
                  </Link>
                  <Link
                    to="/admin/invites"
                    activeProps={{ 'aria-current': 'page', className: 'font-semibold' }}
                  >
                    Invites
                  </Link>
                </>
              )}
            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-3 text-sm">
            {user ? (
              <>
                <span>
                  {user.displayName}{' '}
                  <span className="opacity-70">
                    ({user.role === 'admin' ? 'administrator' : 'player'})
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void onSignOut()}
                  className="rounded border border-stone-300 px-3 py-1 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                >
                  Sign out
                </button>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
