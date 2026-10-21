import { useQuery } from '@tanstack/react-query'
import { Outlet } from '@tanstack/react-router'
import { ThemeToggleButton } from '@/layout/ThemeMenu'
import { trpc } from '@/lib/trpc'

/** Centered frame for setup, sign-in and registration. */
export function AuthLayout() {
  const status = useQuery(trpc.system.status.queryOptions())
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex flex-col">
          <span className="font-display text-xl font-semibold leading-tight">
            {status.data?.instanceName ?? 'Scriptorium'}
          </span>
          <span className="text-xs text-muted-foreground">
            Characters, campaigns and homebrew, self-hosted.
          </span>
        </div>
        <ThemeToggleButton />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12"
      >
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
