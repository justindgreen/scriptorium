import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseContentPackage, type MonsterData } from '@scriptorium/content-schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applyOverlays,
  buildPackages,
  convertEquipment,
  convertMonsters,
  convertSpells,
  SOURCE,
} from '../src/convert.js'
import { UPSTREAM_FILES } from '../src/download.js'

/** A tiny upstream-shaped dataset: one of each thing the converter has to get right. */
const fixtures: Record<string, unknown[]> = {
  Spells: [
    {
      index: 'fire-bolt',
      name: 'Fire Bolt',
      desc: ['You hurl a mote of fire at a creature or object within range.'],
      higher_level: [],
      range: '120 feet',
      components: ['V', 'S'],
      ritual: false,
      duration: 'Instantaneous',
      concentration: false,
      casting_time: '1 action',
      level: 0,
      attack_type: 'ranged',
      damage: {
        damage_type: { index: 'fire', name: 'Fire' },
        damage_at_character_level: { '1': '1d10', '5': '2d10' },
      },
      school: { index: 'evocation', name: 'Evocation' },
      classes: [
        { index: 'sorcerer', name: 'Sorcerer' },
        { index: 'wizard', name: 'Wizard' },
      ],
      subclasses: [],
    },
  ],
  Equipment: [
    {
      index: 'longsword',
      name: 'Longsword',
      equipment_category: { index: 'weapon' },
      weapon_category: 'Martial',
      weapon_range: 'Melee',
      category_range: 'Martial Melee',
      cost: { quantity: 15, unit: 'gp' },
      damage: { damage_dice: '1d8', damage_type: { index: 'slashing' } },
      two_handed_damage: { damage_dice: '1d10', damage_type: { index: 'slashing' } },
      range: { normal: 5, long: null },
      weight: 3,
      properties: [{ index: 'versatile', name: 'Versatile' }],
    },
    {
      index: 'shield',
      name: 'Shield',
      equipment_category: { index: 'armor' },
      armor_category: 'Shield',
      armor_class: { base: 2, dex_bonus: false },
      cost: { quantity: 10, unit: 'gp' },
      weight: 6,
    },
    {
      index: 'chain-mail',
      name: 'Chain Mail',
      equipment_category: { index: 'armor' },
      armor_category: 'Heavy',
      armor_class: { base: 16, dex_bonus: false },
      str_minimum: 13,
      stealth_disadvantage: true,
      cost: { quantity: 75, unit: 'gp' },
      weight: 55,
    },
  ],
  'Magic-Items': [
    {
      index: 'ring-of-protection',
      name: 'Ring of Protection',
      equipment_category: { index: 'ring' },
      rarity: { name: 'Rare' },
      variants: [],
      variant: false,
      desc: [
        'Ring, rare (requires attunement)',
        'You gain a +1 bonus to AC and saving throws while wearing this ring.',
      ],
    },
  ],
  Monsters: [
    {
      index: 'skeleton',
      name: 'Skeleton',
      size: 'Medium',
      type: 'undead',
      alignment: 'lawful evil',
      armor_class: [{ type: 'armor', value: 13 }],
      hit_points: 13,
      hit_dice: '2d8',
      hit_points_roll: '2d8+4',
      speed: { walk: '30 ft.' },
      strength: 10,
      dexterity: 14,
      constitution: 15,
      intelligence: 6,
      wisdom: 8,
      charisma: 5,
      proficiencies: [],
      damage_vulnerabilities: ['bludgeoning'],
      damage_resistances: [],
      damage_immunities: ['poison'],
      condition_immunities: [
        { index: 'exhaustion', name: 'Exhaustion' },
        { index: 'poisoned', name: 'Poisoned' },
      ],
      senses: { darkvision: '60 ft.', passive_perception: 9 },
      languages: 'understands all languages it knew in life but cannot speak',
      challenge_rating: 0.25,
      proficiency_bonus: 2,
      xp: 50,
      special_abilities: [],
      actions: [
        {
          name: 'Shortsword',
          desc: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) piercing damage.',
          attack_bonus: 4,
          damage: [{ damage_type: { index: 'piercing' }, damage_dice: '1d6+2' }],
        },
        {
          name: 'Shortbow',
          desc: 'Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.',
          attack_bonus: 4,
          damage: [{ damage_type: { index: 'piercing' }, damage_dice: '1d6+2' }],
        },
      ],
    },
  ],
  Conditions: [{ index: 'prone', name: 'Prone', desc: ['A prone creature can only crawl.'] }],
  Rules: [
    {
      index: 'combat',
      name: 'Combat',
      desc: '# Combat',
      subsections: [{ index: 'the-order-of-combat', name: 'The Order of Combat' }],
    },
  ],
  'Rule-Sections': [
    { index: 'the-order-of-combat', name: 'The Order of Combat', desc: '## The Order of Combat' },
  ],
  Classes: [
    {
      index: 'fighter',
      name: 'Fighter',
      hit_die: 10,
      proficiency_choices: [
        {
          desc: 'Choose two skills',
          choose: 2,
          type: 'proficiencies',
          from: {
            option_set_type: 'options_array',
            options: [
              {
                option_type: 'reference',
                item: { index: 'skill-athletics', name: 'Skill: Athletics' },
              },
              {
                option_type: 'reference',
                item: { index: 'skill-perception', name: 'Skill: Perception' },
              },
            ],
          },
        },
      ],
      proficiencies: [
        { index: 'all-armor', name: 'All armor' },
        { index: 'shields', name: 'Shields' },
        { index: 'simple-weapons', name: 'Simple Weapons' },
        { index: 'martial-weapons', name: 'Martial Weapons' },
      ],
      saving_throws: [{ index: 'str' }, { index: 'con' }],
      starting_equipment: [],
      starting_equipment_options: [
        {
          desc: '(a) chain mail or (b) leather armor',
          choose: 1,
          type: 'equipment',
          from: {
            option_set_type: 'options_array',
            options: [
              {
                option_type: 'counted_reference',
                count: 1,
                of: { index: 'chain-mail', name: 'Chain Mail' },
              },
            ],
          },
        },
      ],
      multi_classing: {
        prerequisite_options: {
          choose: 1,
          type: 'ability_scores',
          from: {
            option_set_type: 'options_array',
            options: [
              {
                option_type: 'score_prerequisite',
                ability_score: { index: 'str' },
                minimum_score: 13,
              },
              {
                option_type: 'score_prerequisite',
                ability_score: { index: 'dex' },
                minimum_score: 13,
              },
            ],
          },
        },
        proficiencies: [{ index: 'light-armor', name: 'Light Armor' }],
      },
      subclasses: [{ index: 'champion' }],
    },
  ],
  Subclasses: [
    {
      index: 'champion',
      class: { index: 'fighter' },
      name: 'Champion',
      subclass_flavor: 'Martial Archetype',
      desc: ['The archetypal Champion focuses on raw physical power.'],
    },
  ],
  Levels: [
    {
      index: 'fighter-1',
      level: 1,
      prof_bonus: 2,
      features: [
        { index: 'fighting-style', name: 'Fighting Style' },
        { index: 'second-wind', name: 'Second Wind' },
      ],
      class_specific: { action_surges: 0, indomitable_uses: 0, extra_attacks: 0 },
      class: { index: 'fighter' },
    },
    {
      index: 'fighter-3',
      level: 3,
      prof_bonus: 2,
      features: [],
      class_specific: { action_surges: 1 },
      class: { index: 'fighter' },
    },
    {
      index: 'champion-3',
      level: 3,
      prof_bonus: 2,
      features: [{ index: 'improved-critical', name: 'Improved Critical' }],
      class: { index: 'fighter' },
      subclass: { index: 'champion' },
    },
  ],
  Features: [
    {
      index: 'fighting-style',
      class: { index: 'fighter' },
      name: 'Fighting Style',
      level: 1,
      desc: ['You adopt a particular style of fighting.'],
    },
    {
      index: 'second-wind',
      class: { index: 'fighter' },
      name: 'Second Wind',
      level: 1,
      desc: ['You have a limited well of stamina.'],
    },
    {
      index: 'improved-critical',
      class: { index: 'fighter' },
      subclass: { index: 'champion' },
      name: 'Improved Critical',
      level: 3,
      desc: ['Your weapon attacks score a critical hit on a roll of 19 or 20.'],
    },
  ],
  Races: [
    {
      index: 'dwarf',
      name: 'Dwarf',
      speed: 25,
      ability_bonuses: [{ ability_score: { index: 'con' }, bonus: 2 }],
      alignment: 'Most dwarves are lawful.',
      age: 'Dwarves mature at the same rate as humans.',
      size: 'Medium',
      size_description: 'Dwarves stand between 4 and 5 feet tall.',
      languages: [],
      language_desc: 'You can speak, read, and write Common and Dwarvish.',
      traits: [{ index: 'darkvision', name: 'Darkvision' }],
      subraces: [{ index: 'hill-dwarf', name: 'Hill Dwarf' }],
    },
  ],
  Subraces: [
    {
      index: 'hill-dwarf',
      name: 'Hill Dwarf',
      race: { index: 'dwarf' },
      desc: 'As a hill dwarf, you have keen senses.',
      ability_bonuses: [{ ability_score: { index: 'wis' }, bonus: 1 }],
      racial_traits: [{ index: 'dwarven-toughness', name: 'Dwarven Toughness' }],
    },
  ],
  Traits: [
    {
      index: 'darkvision',
      races: [{ index: 'dwarf' }],
      subraces: [],
      name: 'Darkvision',
      desc: ['You can see in dim light within 60 feet.'],
    },
    {
      index: 'dwarven-toughness',
      races: [],
      subraces: [{ index: 'hill-dwarf' }],
      name: 'Dwarven Toughness',
      desc: ['Your hit point maximum increases by 1 per level.'],
    },
  ],
  Backgrounds: [
    {
      index: 'acolyte',
      name: 'Acolyte',
      starting_proficiencies: [{ index: 'skill-insight' }, { index: 'skill-religion' }],
      language_options: { choose: 2, type: 'languages' },
      starting_equipment: [],
      feature: {
        name: 'Shelter of the Faithful',
        desc: ['You command the respect of those who share your faith.'],
      },
      personality_traits: {
        from: {
          options: [{ option_type: 'string', string: 'I idolize a particular hero of my faith.' }],
        },
      },
      ideals: { from: { options: [{ option_type: 'ideal', desc: 'Tradition.' }] } },
      bonds: { from: { options: [] } },
      flaws: { from: { options: [] } },
    },
  ],
  Feats: [
    {
      index: 'grappler',
      name: 'Grappler',
      prerequisites: [{ ability_score: { index: 'str' }, minimum_score: 13 }],
      desc: [
        'You have developed the skills necessary to hold your own in close-quarters grappling.',
      ],
    },
  ],
}

let dir = ''

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srd-fixture-'))
  for (const name of UPSTREAM_FILES) {
    fs.writeFileSync(path.join(dir, `5e-SRD-${name}.json`), JSON.stringify(fixtures[name] ?? []))
  }
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('SRD converter', () => {
  it('converts spells with structured fields and class spell lists', () => {
    const entries = convertSpells(dir)
    const spell = entries.find((e) => e.kind === 'spell')!
    expect(spell.uid).toBe('srd-5.1:spell:fire-bolt')
    expect(spell.data).toMatchObject({
      level: 0,
      school: 'evocation',
      castingTimeType: 'action',
      attackType: 'ranged',
      classes: ['srd-5.1:class:sorcerer', 'srd-5.1:class:wizard'],
    })
    const lists = entries.filter((e) => e.kind === 'spell_list')
    expect(lists.map((l) => l.uid).sort()).toEqual([
      'srd-5.1:spell_list:sorcerer',
      'srd-5.1:spell_list:wizard',
    ])
  })

  it('converts weapons, armor and shields', () => {
    const items = convertEquipment(dir)
    const sword = items.find((i) => i.slug === 'longsword')!
    expect(sword.data).toMatchObject({
      category: 'weapon',
      weapon: {
        category: 'martial',
        range: 'melee',
        damage: { dice: '1d8', damageType: 'slashing' },
        versatileDamage: '1d10',
        properties: ['versatile'],
      },
    })
    expect(sword.automation?.level).toBe('full')
    const mail = items.find((i) => i.slug === 'chain-mail')!
    expect(mail.data).toMatchObject({
      category: 'armor',
      armor: {
        category: 'heavy',
        baseAc: 16,
        addDexModifier: false,
        strengthMinimum: 13,
        stealthDisadvantage: true,
      },
    })
    const shield = items.find((i) => i.slug === 'shield')!
    expect(shield.data).toMatchObject({ category: 'shield' })
    expect(shield.effects).toEqual([
      { type: 'bonus', target: 'ac.bonus', value: 2, note: 'Shield' },
    ])
  })

  it('parses monster attacks from the stat block text', () => {
    const [skeleton] = convertMonsters(dir)
    expect(skeleton!.data).toMatchObject({
      size: 'medium',
      type: 'undead',
      challengeRating: 0.25,
      damageVulnerabilities: ['bludgeoning'],
      conditionImmunities: ['exhaustion', 'poisoned'],
    })
    const [melee, ranged] = (skeleton!.data as MonsterData).actions
    expect(melee).toMatchObject({
      attack: { kind: 'melee', toHit: 4, reach: 5 },
      damage: [{ dice: '1d6+2', damageType: 'piercing' }],
    })
    expect(ranged).toMatchObject({
      attack: { kind: 'ranged', toHit: 4, range: { normal: 80, long: 320 } },
    })
  })

  it('builds valid packages for every group and marks unauthored mechanics as pending', () => {
    const result = buildPackages(dir)
    expect(result.issues).toEqual([])
    expect(result.packages.map((p) => p.name).sort()).toEqual([
      'backgrounds-feats',
      'classes',
      'equipment',
      'monsters',
      'rules',
      'species',
      'spells',
    ])
    for (const { package: pkg } of result.packages) {
      expect(parseContentPackage(pkg).ok).toBe(true)
      expect(pkg.source).toEqual(SOURCE)
    }
    const classes = result.packages.find((p) => p.name === 'classes')!.package
    const fighter = classes.entries.find((e) => e.kind === 'class')!
    expect(fighter.automation?.level).toBe('pending')
    expect(fighter.data).toMatchObject({
      hitDie: 'd10',
      primaryAbilities: ['str', 'dex'],
      savingThrows: ['str', 'con'],
      subclassLevel: 3,
      subclassTitle: 'Martial Archetype',
    })
    expect(
      (fighter.data as { multiclassing: { prerequisite: unknown } }).multiclassing.prerequisite,
    ).toEqual({
      any: [
        { leaf: 'abilityScore', ability: 'str', gte: 13 },
        { leaf: 'abilityScore', ability: 'dex', gte: 13 },
      ],
    })
    const champion = classes.entries.find((e) => e.kind === 'subclass')!
    expect(champion.data).toMatchObject({
      class: 'srd-5.1:class:fighter',
      levels: [{ level: 3, features: ['srd-5.1:feature:improved-critical'] }],
    })
    const species = result.packages.find((p) => p.name === 'species')!.package
    const hill = species.entries.find((e) => e.slug === 'hill-dwarf')!
    expect(hill.data).toMatchObject({
      parent: 'srd-5.1:species:dwarf',
      traits: [{ uid: 'srd-5.1:feature:dwarven-toughness', name: 'Dwarven Toughness' }],
    })
    const feats = result.packages.find((p) => p.name === 'backgrounds-feats')!.package
    expect(feats.entries.find((e) => e.kind === 'feat')!.data).toMatchObject({
      prerequisite: { leaf: 'abilityScore', ability: 'str', gte: 13 },
    })
  })

  it('applies mechanics overlays by uid and reports unmatched ones', () => {
    const items = convertEquipment(dir)
    const { entries, unmatched } = applyOverlays(items, [
      { uid: 'srd-5.1:item:longsword', tags: ['overlaid'] },
      { uid: 'srd-5.1:item:does-not-exist', effects: [] },
    ])
    expect(entries.find((e) => e.slug === 'longsword')!.tags).toContain('overlaid')
    expect(unmatched).toEqual(['srd-5.1:item:does-not-exist'])
  })
})
