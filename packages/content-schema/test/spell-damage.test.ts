import { describe, expect, it } from 'vitest'
import { contentEntrySchema } from '../src/index.js'

/**
 * D-1 (M3.2): spell damage is a list of typed entries. The previous shape, a single object that
 * the converter left empty, is still accepted and normalised, so stored content versions pinned
 * by characters keep parsing after the change (controlled change process, ADR-0042).
 */
function spell(damage: unknown) {
  return contentEntrySchema.parse({
    kind: 'spell',
    uid: 'test:spell:bolt',
    slug: 'bolt',
    name: 'Bolt',
    data: {
      level: 3,
      school: 'evocation',
      castingTime: '1 action',
      castingTimeType: 'action',
      range: '150 feet',
      components: { verbal: true, somatic: true, material: false },
      duration: 'Instantaneous',
      concentration: false,
      ritual: false,
      description: 'Boom.',
      classes: [],
      subclasses: [],
      ...(damage === undefined ? {} : { damage }),
    },
    effects: [],
    choices: [],
    tests: [],
    tags: [],
    relations: [],
  }) as { data: { damage?: unknown } }
}

describe('spell damage shape', () => {
  it('normalises the pre-D-1 single object, including the empty one, to the entry list', () => {
    expect(spell({}).data.damage).toEqual([])
    expect(spell({ damageType: 'fire', bySlotLevel: { '3': '8d6' } }).data.damage).toEqual([
      { damageType: 'fire', bySlotLevel: { '3': '8d6' } },
    ])
    expect(spell(undefined).data.damage).toBeUndefined()
  })

  it('keeps the entry list as is, typed entries and untyped pools alike', () => {
    const list = [
      { damageType: 'fire', bySlotLevel: { '5': '4d6' } },
      { damageType: 'radiant', bySlotLevel: { '5': '4d6' } },
      { bySlotLevel: { '1': '5d8' } },
    ]
    expect(spell(list).data.damage).toEqual(list)
  })

  it('rejects an unknown damage type', () => {
    expect(() => spell([{ damageType: 'emotional', bySlotLevel: { '1': '1d4' } }])).toThrow()
  })
})
