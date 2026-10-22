import { describe, expect, it } from 'vitest'
import {
  ENGINE_VERSION,
  SUPPORTED_CONTENT_SCHEMA_VERSION,
  allowedDependencies,
} from '../src/index.js'

describe('@scriptorium/rules-engine package', () => {
  it('resolves its workspace dependencies', () => {
    expect(ENGINE_VERSION).toBe('0.2.0')
    expect(SUPPORTED_CONTENT_SCHEMA_VERSION).toBe(1)
    expect(allowedDependencies).toEqual(['@scriptorium/dice/ast', '@scriptorium/content-schema'])
  })
})
