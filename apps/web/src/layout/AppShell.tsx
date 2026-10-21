import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { CommandIcon, LogOutIcon, MenuIcon, UserIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { CommandPalette } from '@/layout/CommandPalette'
import { ThemeRadioItems } from '@/layout/ThemeMenu'
import { visibleNavItems, type NavItem } from '@/layout/navigation'
import { signOutEverywhere } from '@/lib/auth-client'
import { resetSessionCache, type Me } from '@/lib/session'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

/**
 * Authenticated application frame: sidebar on large screens, top bar with a drawer on small
 * ones, user menu with theme and sign-out, command palette, skip link, main landmark.
 */
export function AppShell() {
  const navigate = useNavigate()
  const status = useQuery(trpc.system.status.queryOptions())
  const me = useQuery(trpc.me.get.queryOptions())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const user = me.data
  if (!user) return null

  const items = visibleNavItems(user.role)
  const instanceName = status.data?.instanceName ?? 'Scriptorium'

  async function onSignOut() {
    await signOutEverywhere()
    await resetSessionCache()
    await navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* Sidebar (large screens) */}
      <aside
        className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col"
        aria-label="Sidebar"
      >
        <Brand name={instanceName} className="px-5 py-5" />
        <NavList items={items} className="flex-1 px-3" />
        <div className="border-t border-sidebar-border p-3">
          <UserMenu user={user} onSignOut={() => void onSignOut()} />
          <Link
            to="/licenses"
            className="mt-2 block px-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Licences and attribution
          </Link>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        {/* Top bar (small screens) */}
        <header className="flex items-center gap-2 border-b bg-card px-3 py-2 lg:hidden">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation"
                data-testid="open-navigation"
              >
                <MenuIcon aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-0 text-sidebar-foreground">
              <SheetHeader className="px-5 py-5">
                <SheetTitle className="font-display text-left text-xl">{instanceName}</SheetTitle>
                <SheetDescription className="sr-only">Navigation</SheetDescription>
              </SheetHeader>
              <NavList items={items} className="px-3" onNavigate={() => setDrawerOpen(false)} />
              <div className="mt-auto border-t border-sidebar-border p-3">
                <UserMenu user={user} onSignOut={() => void onSignOut()} />
              </div>
            </SheetContent>
          </Sheet>
          <Link to="/" className="font-display truncate text-lg font-semibold">
            {instanceName}
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <UserMenu user={user} compact onSignOut={() => void onSignOut()} />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette role={user.role} onSignOut={() => void onSignOut()} />
    </div>
  )
}

function Brand(props: { name: string; className?: string }) {
  return (
    <div className={cn('flex flex-col', props.className)}>
      <Link to="/" className="font-display text-xl font-semibold leading-tight">
        {props.name}
      </Link>
      <span className="text-xs text-muted-foreground">Scriptorium</span>
    </div>
  )
}

function NavList(props: { items: NavItem[]; className?: string; onNavigate?: () => void }) {
  const main = props.items.filter((i) => i.group === 'main')
  const admin = props.items.filter((i) => i.group === 'admin')
  return (
    <nav aria-label="Primary" className={cn('space-y-6 py-2', props.className)}>
      <NavGroup items={main} onNavigate={props.onNavigate} />
      {admin.length > 0 ? (
        <NavGroup label="Administration" items={admin} onNavigate={props.onNavigate} />
      ) : null}
    </nav>
  )
}

function NavGroup(props: { label?: string; items: NavItem[]; onNavigate?: () => void }) {
  return (
    <div>
      {props.label ? (
        <p className="mb-1 px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {props.label}
        </p>
      ) : null}
      <ul className="space-y-0.5">
        {props.items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              onClick={props.onNavigate}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 focus-visible:outline-none"
              activeOptions={{ exact: item.to === '/' }}
              activeProps={{
                className: 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
                'aria-current': 'page',
              }}
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function UserMenu(props: { user: Me; compact?: boolean; onSignOut: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {props.compact ? (
          <Button variant="ghost" size="icon" aria-label="Account menu" data-testid="account-menu">
            <UserIcon aria-hidden="true" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-3 px-2 py-2"
            data-testid="account-menu"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserIcon className="size-4" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-col items-start">
              <span className="truncate text-sm font-medium">{props.user.displayName}</span>
              <span className="text-xs text-muted-foreground">
                {props.user.role === 'admin' ? 'Administrator' : 'Player'}
              </span>
            </span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium">{props.user.displayName}</span>
          <span className="block text-xs text-muted-foreground">@{props.user.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeRadioItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <CommandIcon aria-hidden="true" /> Command palette
          <span className="ml-auto text-xs text-muted-foreground">Ctrl K</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onSignOut}>
          <LogOutIcon aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
