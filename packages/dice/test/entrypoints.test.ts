import { describe, expect, it } from 'vitest'
import { packageName as ast } from '../src/ast/index.js'
import { packageName as roll, dependsOn } from '../src/roll/index.js'

describe('@scriptorium/dice entry points', () => {
  it('exposes distinct ast and roll entry points', () => {
    expect(ast).toBe('@scriptorium/dice/ast')
    expect(roll).toBe('@scriptorium/dice/roll')
  })

  it('roll depends on ast, never the reverse', () => {
    expect(dependsOn).toBe(ast)
  })
})
