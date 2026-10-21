import { TRPCError } from '@trpc/server'

export type Role = 'admin' | 'user'

/** Who is acting. Built once per request from the session; passed to every policy check and repo. */
export type Scope = {
  userId: string | null
  role: Role | null
}

export const anonymousScope: Scope = { userId: null, role: null }

/**
 * Every protected operation names an action. Campaign and character actions are added with their
 * modules; the shape stays `can(scope, action, resource?)` so resource-level checks slot in.
 */
export type Action =
  | 'me.read'
  | 'content.read'
  | 'admin.content.manage'
  | 'admin.users.manage'
  | 'admin.invites.manage'
  | 'admin.audit.read'
  | 'admin.settings.manage'

const adminActions: ReadonlySet<Action> = new Set([
  'admin.users.manage',
  'admin.invites.manage',
  'admin.audit.read',
  'admin.settings.manage',
  'admin.content.manage',
])

export function can(scope: Scope, action: Action): boolean {
  if (!scope.userId || !scope.role) return false
  if (adminActions.has(action)) return scope.role === 'admin'
  switch (action) {
    case 'me.read':
    case 'content.read':
      return true
    default:
      return false
  }
}

export function assertCan(scope: Scope, action: Action): void {
  if (!scope.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' })
  }
  if (!can(scope, action)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not allowed to do that.' })
  }
}

export function toRole(value: unknown): Role {
  return value === 'admin' ? 'admin' : 'user'
}
