import { describe, expect, it } from 'vitest'
import { anonymousScope, assertCan, can, type Action, type Scope } from '../src/core/policy.js'

const admin: Scope = { userId: 'a', role: 'admin' }
const player: Scope = { userId: 'p', role: 'user' }

const matrix: Array<[Action, boolean, boolean, boolean]> = [
  // action, anonymous, player, admin
  ['me.read', false, true, true],
  ['character.create', false, true, true],
  ['character.read', false, true, true],
  ['character.write', false, true, true],
  ['admin.users.manage', false, false, true],
  ['admin.invites.manage', false, false, true],
  ['admin.audit.read', false, false, true],
  ['admin.settings.manage', false, false, true],
]

describe('policy', () => {
  it.each(matrix)('%s: anonymous=%s player=%s admin=%s', (action, anon, p, a) => {
    expect(can(anonymousScope, action)).toBe(anon)
    expect(can(player, action)).toBe(p)
    expect(can(admin, action)).toBe(a)
  })

  it('throws UNAUTHORIZED for anonymous and FORBIDDEN for insufficient role', () => {
    expect(() => assertCan(anonymousScope, 'me.read')).toThrowError(/Sign in/)
    expect(() => assertCan(player, 'admin.users.manage')).toThrowError(/not allowed/)
    expect(() => assertCan(admin, 'admin.users.manage')).not.toThrow()
  })
})
