# Design System

Scriptorium's visual identity: illuminated manuscript meets modern editorial. Warm paper and ink in light mode, deep charcoal and parchment in dark mode, one garnet accent, a serif display face for headings and a humanist sans for everything else. Dense when it needs to be (character sheets), calm everywhere else.

## Tokens

Defined as CSS custom properties in `apps/web/src/index.css` and exposed to Tailwind v4 through `@theme inline`, so components use `bg-background`, `text-muted-foreground`, `border-sidebar-border` and so on. Colours are oklch so light and dark palettes keep consistent perceived contrast.

| Token                          | Light                 | Dark                 | Use                                 |
| ------------------------------ | --------------------- | -------------------- | ----------------------------------- |
| `background` / `foreground`    | warm paper / warm ink | charcoal / parchment | page                                |
| `card`, `popover`              | near-white paper      | lifted charcoal      | surfaces                            |
| `primary`                      | garnet                | lighter garnet       | primary actions, active states      |
| `secondary`, `muted`, `accent` | sands                 | warm greys           | secondary actions, hints, hover     |
| `destructive`                  | red                   | softer red           | dangerous actions, errors           |
| `success`, `warning`           | green, amber          | brighter             | status badges, healing/damage later |
| `border`, `input`, `ring`      | sand lines            | translucent white    | outlines, focus ring                |
| `sidebar-*`                    | slightly darker paper | darker charcoal      | the navigation rail                 |

Radius is 0.5rem (`--radius`) with `sm/md/lg/xl` steps. Spacing follows Tailwind's scale.

## Typography

- Display: Fraunces (variable) for `h1`–`h3` and `.font-display`. Headings use slight negative tracking.
- Text and UI: Inter (variable). `.tabular` (tabular numerals) for anything numeric in a column: HP, modifiers, dates.
- Monospace: system stack, used for invite codes and raw identifiers.

Both families are bundled from `@fontsource-variable/*`, so the application works offline and never calls a font CDN.

## Themes and motion

`ThemeProvider` stores `light | dark | system` in `localStorage['scriptorium.theme']`, applies the `dark` class on `<html>`, and follows the OS when set to system. An inline script in `index.html` applies the stored choice before first paint. `prefers-reduced-motion` collapses all animations and transitions globally; components should additionally use `motion-reduce:` variants where they animate layout.

## Components

Generated into `apps/web/src/components/ui/` with the shadcn CLI (`components.json`, style `new-york`, Radix primitives via the `radix-ui` package, Lucide icons). They are ours to edit: adjust them in place rather than wrapping. Currently: alert, badge, button, card, checkbox, command, dialog, dropdown-menu, input, label, popover, select, separator, sheet, skeleton, sonner (toasts), table, tabs, textarea, tooltip. Add more with `pnpm dlx shadcn@latest add <name>` from `apps/web`, then fix the import of `cn` to `@/lib/utils` if the CLI cannot resolve the alias.

Application-level pieces live in `src/components` and `src/layout`:

- `PageHeader` (title, description, actions), `EmptyState`, `ErrorState` (with retry), `LoadingState` (skeleton rows, polite status).
- `FormField` + `FormError`: label, control, hint and an `aria-live` error.
- `AppShell`: sidebar from `lg`, top bar with a navigation drawer below, user menu (theme radio, sign out), command palette (Ctrl/Cmd+K), skip link, `main#main`.
- `AuthLayout`: centred card frame for setup, sign-in and registration, with a theme toggle.
- `navigation.ts`: the single list of destinations shared by the sidebar, drawer and palette. Only destinations that exist are listed.

## Patterns and rules

- Every list has an empty state that says what to do next, a loading state and an error state with retry.
- Mutations report through toasts (`sonner`) and refresh their queries; destructive actions confirm in a dialog that explains the consequence.
- No placeholder controls: a visible button does something.
- Accessibility: visible focus rings, labelled controls, `aria-current` on active navigation, dialogs trap focus (Radix), icons are `aria-hidden` with text labels, headings are in order with exactly one `h1` per page. Playwright runs axe (WCAG 2.1 AA, serious and critical impacts) on each page it visits.
- Responsive breakpoints: phone (375), tablet (768), desktop (1280) are the three widths tested end to end.
- Game-specific colour tokens (damage types, conditions, spell schools) are added when the character sheet lands, as additional `--color-*` entries here, never as ad-hoc hex values in components.
