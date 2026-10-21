import { useNavigate } from '@tanstack/react-router'
import { LogOutIcon, MoonIcon, SunIcon, SunMoonIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { visibleNavItems } from '@/layout/navigation'
import { useTheme } from '@/theme/ThemeProvider'

/** Ctrl/Cmd+K palette: navigate, switch theme, sign out. Only actions that exist are listed. */
export function CommandPalette(props: { role: 'admin' | 'user'; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { setPreference } = useTheme()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function run(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Jump to a page or run an action"
    >
      <CommandInput placeholder="Where to?" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Go to">
          {visibleNavItems(props.role).map((item) => (
            <CommandItem
              key={item.to}
              value={`${item.label} ${item.keywords?.join(' ') ?? ''}`}
              onSelect={() => run(() => void navigate({ to: item.to }))}
            >
              <item.icon aria-hidden="true" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem value="light theme" onSelect={() => run(() => setPreference('light'))}>
            <SunIcon aria-hidden="true" />
            Light
          </CommandItem>
          <CommandItem value="dark theme" onSelect={() => run(() => setPreference('dark'))}>
            <MoonIcon aria-hidden="true" />
            Dark
          </CommandItem>
          <CommandItem value="system theme" onSelect={() => run(() => setPreference('system'))}>
            <SunMoonIcon aria-hidden="true" />
            Follow system
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Account">
          <CommandItem value="sign out" onSelect={() => run(props.onSignOut)}>
            <LogOutIcon aria-hidden="true" />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
