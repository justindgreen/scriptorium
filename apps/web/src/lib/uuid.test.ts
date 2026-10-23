import { describe, expect, it } from 'vitest'
import { UUID_V4, UuidUnavailableError, newUuid } from './uuid'

/**
 * Regression for GitHub issue #2: command ids must work on plain-HTTP LAN origins, where
 * `crypto.randomUUID` does not exist. Nothing here assumes a secure context.
 */
describe('newUuid', () => {
  it('builds version-4 UUIDs from getRandomValues when randomUUID is absent', () => {
    const insecure = {
      getRandomValues: (a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a),
    }
    const ids = new Set(Array.from({ length: 500 }, () => newUuid(insecure)))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  })

  it('prefers randomUUID when the platform offers it', () => {
    const id = newUuid({ randomUUID: () => '11111111-2222-4333-8444-555555555555' })
    expect(id).toBe('11111111-2222-4333-8444-555555555555')
  })

  it('fails loudly rather than falling back to weak randomness', () => {
    expect(() => newUuid({})).toThrowError(UuidUnavailableError)
    expect(() => newUuid({ randomUUID: undefined, getRandomValues: undefined })).toThrowError(
      /secure random/,
    )
  })

  it('produces ids the server accepts as uuids', () => {
    expect(newUuid()).toMatch(UUID_V4)
  })
})
