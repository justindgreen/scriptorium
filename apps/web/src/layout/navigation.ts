import {
  ArchiveIcon,
  HammerIcon,
  HomeIcon,
  KeyRoundIcon,
  ScrollTextIcon,
  UsersRoundIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

export type AppPath =
  | '/'
  | '/characters'
  | '/characters/new'
  | '/homebrew'
  | '/admin/users'
  | '/admin/invites'
  | '/admin/audit'
  | '/admin/settings'
  | '/admin/backups'
  | '/licenses'

export type NavItem = {
  to: AppPath
  label: string
  icon: LucideIcon
  group: 'main' | 'admin'
  /** Words that also match this item in the command palette. */
  keywords?: string[]
}

/**
 * Single source for sidebar, mobile drawer and command palette. Only destinations that exist
 * appear here; sections arrive with their milestones (characters, campaigns, compendium, ...).
 */
export const navItems: NavItem[] = [
  { to: '/', label: 'Home', icon: HomeIcon, group: 'main' },
  {
    to: '/characters',
    label: 'Characters',
    icon: UsersRoundIcon,
    group: 'main',
    keywords: ['sheet', 'builder', 'party'],
  },
  {
    to: '/homebrew',
    label: 'Homebrew',
    icon: HammerIcon,
    group: 'main',
    keywords: ['magic item', 'editor', 'custom', 'source'],
  },
  {
    to: '/admin/users',
    label: 'Users',
    icon: UsersIcon,
    group: 'admin',
    keywords: ['players', 'roles'],
  },
  {
    to: '/admin/invites',
    label: 'Invites',
    icon: KeyRoundIcon,
    group: 'admin',
    keywords: ['register', 'codes'],
  },
  {
    to: '/admin/audit',
    label: 'Audit log',
    icon: ScrollTextIcon,
    group: 'admin',
    keywords: ['history', 'security'],
  },
  {
    to: '/admin/settings',
    label: 'Settings',
    icon: SettingsIcon,
    group: 'admin',
    keywords: ['instance', 'name'],
  },
  {
    to: '/admin/backups',
    label: 'Backups',
    icon: ArchiveIcon,
    group: 'admin',
    keywords: ['restore', 'dump', 'archive'],
  },
]

export function visibleNavItems(role: 'admin' | 'user' | null): NavItem[] {
  return navItems.filter((item) => item.group === 'main' || role === 'admin')
}
