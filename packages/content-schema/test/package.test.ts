import { describe, expect, it } from 'vitest'
import { parseContentPackage } from '../src/index.js'

const source = {
  slug: 'test-pack',
  name: 'Test Pack',
  kind: 'homebrew',
  license: 'CC-BY-4.0',
  attributionText: 'Test content.',
  version: '1.0.0',
}

const spell = {
  kind: 'spell',
  uid: 'test-pack:spell:glimmer',
  slug: 'glimmer',
  name: 'Glimmer',
  data: {
    level: 0,
    school: 'evocation',
    castingTime: '1 action',
    castingTimeType: 'action',
    range: '60 feet',
    components: { verbal: true, somatic: true, material: false },
    duration: 'Instantaneous',
    concentration: false,
    ritual: false,
    description: 'A mote of light.',
    classes: ['test-pack:class:wizard'],
  },
}

describe('content packages', () => {
  it('parses a valid package', () => {
    const result = parseContentPackage({
      format: 'scriptorium-content-package',
      formatVersion: 1,
      source,
      rulesetId: 'srd5.1-2014',
      entries: [spell],
    })
    expect(result.ok).toBe(true)
  })

  it('reports duplicate uids and foreign uids with paths', () => {
    const foreign = { ...spell, uid: 'other:spell:glimmer' }
    const result = parseContentPackage({
      format: 'scriptorium-content-package',
      formatVersion: 1,
      source,
      rulesetId: 'srd5.1-2014',
      entries: [spell, spell, foreign],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.issues.some((i) => i.path === 'entries.1.uid' && /duplicate/.test(i.message)),
      ).toBe(true)
      expect(
        result.issues.some((i) => i.path === 'entries.2.uid' && /does not belong/.test(i.message)),
      ).toBe(true)
    }
  })

  it('rejects unknown fields (typos never pass silently)', () => {
    const result = parseContentPackage({
      format: 'scriptorium-content-package',
      formatVersion: 1,
      source,
      rulesetId: 'srd5.1-2014',
      entries: [{ ...spell, data: { ...spell.data, ritaul: true } }],
    })
    expect(result.ok).toBe(false)
  })
})
