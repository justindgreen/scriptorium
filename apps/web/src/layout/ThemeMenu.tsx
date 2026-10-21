import { MoonIcon, SunIcon, SunMoonIcon } from 'lucide-react'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider'

/** Radio group of theme choices for use inside a dropdown menu. */
export function ThemeRadioItems() {
  const { preference, setPreference } = useTheme()
  return (
    <>
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={preference}
        onValueChange={(v) => setPreference(v as ThemePreference)}
      >
        <DropdownMenuRadioItem value="light">
          <SunIcon aria-hidden="true" /> Light
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark">
          <MoonIcon aria-hidden="true" /> Dark
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="system">
          <SunMoonIcon aria-hidden="true" /> Follow system
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  )
}

/** Single button that cycles light → dark → system, for layouts without a menu. */
export function ThemeToggleButton() {
  const { preference, resolved, setPreference } = useTheme()
  const next: ThemePreference =
    preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light'
  const label = `Theme: ${preference === 'system' ? `follows system (${resolved})` : preference}. Switch to ${next}.`
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => setPreference(next)}
      data-testid="theme-toggle"
    >
      {preference === 'system' ? (
        <SunMoonIcon aria-hidden="true" />
      ) : resolved === 'dark' ? (
        <MoonIcon aria-hidden="true" />
      ) : (
        <SunIcon aria-hidden="true" />
      )}
    </Button>
  )
}
