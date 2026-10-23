// Generates the alpha mechanics overlays and fixtures (content/srd-5.1/mechanics/).
// pnpm -F @scriptorium/srd-import generate-overlays   (then re-run convert)
import fs from 'node:fs'
import path from 'node:path'

const out = path.join(import.meta.dirname, '..', '..', '..', 'content', 'srd-5.1', 'mechanics')
fs.mkdirSync(path.join(out, 'fixtures'), { recursive: true })

const F = (slug) => `srd-5.1:feature:${slug}`
const CLASS = (slug) => `srd-5.1:class:${slug}`
const SUB = (slug) => `srd-5.1:subclass:${slug}`
const SPELL = (slug) => `srd-5.1:spell:${slug}`
const ITEM = (slug) => `srd-5.1:item:${slug}`
const SPECIES = (slug) => `srd-5.1:species:${slug}`

const full = { level: 'full' }
const partial = (manualParts, notes) => ({
  level: 'partial',
  manualParts,
  ...(notes ? { notes } : {}),
})
const manualLevel = (notes) => ({ level: 'manual', ...(notes ? { notes } : {}) })
const placeholder = (uid, text, notes) => ({
  uid,
  effects: [manual(text)],
  automation: manualLevel(notes),
  tags: ['placeholder'],
})
const manual = (text) => ({ type: 'manual', text })
const resource = (id, name, max, recharge, extra = {}) => ({
  type: 'resource.define',
  resource: { id, name, max, recharge, ...extra },
})
const grantSpell = (slug, extra = {}) => ({ type: 'spell.grant', spell: SPELL(slug), ...extra })
const atWill = (slug) => grantSpell(slug, { atWill: true })
const oncePerLongRest = (slug) => grantSpell(slug, { uses: { max: 1, recharge: 'longRest' } })
const asi = {
  type: 'choice',
  key: 'asi',
  name: 'Ability Score Improvement',
  count: 1,
  from: { kind: 'asiOrFeat' },
}

const stat = (fixture, statPath, equals, modify) => ({
  given: { fixture, ...(modify ? { modify } : {}) },
  expect: { stat: statPath, equals },
})
const atLeast = (fixture, statPath, value) => ({
  given: { fixture },
  expect: { stat: statPath, atLeast: value },
})
const plan = (fixture, ref, ctx, contains, excludes, modify) => ({
  given: { fixture, ...(modify ? { modify } : {}) },
  expect: {
    actionPlan: { ref, ctx: ctx ?? {} },
    ...(contains ? { contains } : {}),
    ...(excludes ? { excludes } : {}),
  },
})
const proficient = (fixture, set, id) => ({
  given: { fixture },
  expect: { proficient: { set, id } },
})
const knownSpell = (fixture, slug) => ({ given: { fixture }, expect: { knownSpell: SPELL(slug) } })
const defense = (fixture, kind, damageType) => ({
  given: { fixture },
  expect: { defense: { kind, damageType } },
})

const overlays = {}
const add = (file, entry) => {
  overlays[file] ??= []
  overlays[file].push(entry)
}

// ------------------------------------------------------------------------------------ fighter
const FIGHTER = CLASS('fighter')
const fightingStyleOptions = [
  {
    id: 'archery',
    name: 'Archery',
    effects: [{ type: 'bonus', target: 'attack.ranged', value: 2, note: 'Archery' }],
  },
  {
    id: 'defense',
    name: 'Defense',
    effects: [
      {
        type: 'bonus',
        target: 'ac.bonus',
        value: 1,
        note: 'Defense',
        condition: { leaf: 'armor', category: 'any' },
      },
    ],
  },
  {
    id: 'dueling',
    name: 'Dueling',
    effects: [
      {
        type: 'action.damageAdd',
        formula: '2',
        damageType: 'weapon',
        label: 'Dueling',
        appliesTo: 'melee',
        condition: {
          all: [
            { leaf: 'ctx.wieldingOneHanded' },
            { not: { leaf: 'ctx.weaponProperty', property: 'two-handed' } },
          ],
        },
      },
      manual('Only while you wield no other weapons.'),
    ],
  },
  {
    id: 'great-weapon-fighting',
    name: 'Great Weapon Fighting',
    effects: [
      {
        type: 'action.rerollDamageDice',
        values: [1, 2],
        once: true,
        appliesTo: 'melee',
        condition: { leaf: 'ctx.twoHanded' },
      },
    ],
  },
  {
    id: 'protection',
    name: 'Protection',
    effects: [
      manual(
        'Reaction: impose disadvantage on an attack against a creature within 5 feet while you wield a shield.',
      ),
    ],
  },
  {
    id: 'two-weapon-fighting',
    name: 'Two-Weapon Fighting',
    effects: [
      manual(
        'Add your ability modifier to the damage of your second attack when you fight with two weapons.',
      ),
    ],
  },
]
const styleRefs = fightingStyleOptions.map((o) => ({
  id: o.id,
  name: o.name,
  feature: F(`fighter-fighting-style-${o.id}`),
}))
const fightingStyleChoice = (key, name) => ({
  type: 'choice',
  key,
  name,
  count: 1,
  from: { kind: 'optionSet', options: styleRefs },
})
const styleAutomation = {
  archery: [full, [stat('fighter-20-champion', 'attack.ranged', 2)]],
  defense: [full, [stat('fighter-1', 'ac.bonus', 3)]],
  dueling: [
    partial(['the "no other weapons" check']),
    [
      plan(
        'fighter-1',
        { kind: 'weapon', itemId: 'longsword' },
        {},
        { damage: [{ id: 'dueling', formula: '2' }] },
        undefined,
        {
          definition: {
            choices: {
              'class:srd-5.1:class:fighter@1/feature:fighter-fighting-style/fighting-style': {
                kind: 'optionSet',
                options: ['dueling'],
              },
            },
          },
        },
      ),
    ],
  ],
  'great-weapon-fighting': [
    full,
    [
      plan(
        'fighter-5-warlock-3',
        { kind: 'weapon', itemId: 'greatsword' },
        {},
        { damage: [{ id: 'weapon', formula: '2d6ro1,2 + 4' }] },
      ),
    ],
  ],
  protection: [manualLevel('A reaction the table adjudicates.'), []],
  'two-weapon-fighting': [manualLevel('Off-hand attacks are not modelled yet.'), []],
}
for (const o of fightingStyleOptions) {
  const [automation, tests] = styleAutomation[o.id]
  add('classes-fighter.json', {
    uid: F(`fighter-fighting-style-${o.id}`),
    effects: o.effects,
    automation,
    tests,
  })
}

add('classes-fighter.json', {
  uid: F('fighter-fighting-style'),
  choices: [fightingStyleChoice('fighting-style', 'Fighting Style')],
  automation: full,
  tests: [stat('fighter-1', 'ac.bonus', 3)],
})
add('classes-fighter.json', {
  uid: F('second-wind'),
  effects: [
    resource('second-wind', 'Second Wind', 1, 'shortRest'),
    {
      type: 'action.grant',
      name: 'Second Wind',
      actionType: 'bonus',
      healing: "1d10 + classLevel('srd-5.1:class:fighter')",
      cost: { resource: 'second-wind', amount: 1 },
    },
  ],
  automation: full,
  tests: [
    stat('fighter-1', 'resource.second-wind.max', 1),
    plan(
      'fighter-1',
      {
        kind: 'action',
        templateId: 'action:class:srd-5.1:class:fighter@1/feature:second-wind/second-wind',
      },
      {},
      { healing: '1d10 + 1', actionType: 'bonus' },
    ),
  ],
})
add('classes-fighter.json', {
  uid: F('action-surge-1-use'),
  effects: [
    resource(
      'action-surge',
      'Action Surge',
      "table('action-surges', classLevel('srd-5.1:class:fighter'))",
      'shortRest',
    ),
    manual('On your turn, take one additional action.'),
  ],
  automation: partial(['the additional action itself']),
  tests: [
    stat('fighter-5-champion', 'resource.action-surge.max', 1),
    stat('fighter-20-champion', 'resource.action-surge.max', 2),
  ],
})
add(
  'classes-fighter.json',
  placeholder(
    F('action-surge-2-uses'),
    'Action Surge can now be used twice between rests; the Action Surge resource follows the class table.',
    'Scaling lives on the level-2 feature table.',
  ),
)
add(
  'classes-fighter.json',
  placeholder(
    F('martial-archetype'),
    'Choose a martial archetype in the builder.',
    'Subclass selection is structural.',
  ),
)
for (const n of [1, 2, 3, 4])
  add(
    'classes-fighter.json',
    placeholder(
      F(`martial-archetype-improvement-${n}`),
      'Your martial archetype grants a feature at this level.',
      'Placeholder row; mechanics live on the subclass.',
    ),
  )
for (const n of [1, 2, 3, 4, 5, 6, 7]) {
  add('classes-fighter.json', {
    uid: F(`fighter-ability-score-improvement-${n}`),
    choices: [asi],
    automation: full,
    tests:
      n === 1
        ? [stat('fighter-5-champion', 'ability.str.score', 18)]
        : [stat('fighter-20-champion', 'ability.str.score', 20)],
  })
}
add('classes-fighter.json', {
  uid: F('extra-attack-1'),
  effects: [{ type: 'attack.extra', count: 1 }],
  automation: full,
  tests: [stat('fighter-5-champion', 'attacks.perAction', 2)],
})
add('classes-fighter.json', {
  uid: F('extra-attack-2'),
  effects: [{ type: 'attack.extra', count: 2 }],
  automation: full,
  tests: [
    stat('fighter-20-champion', 'attacks.perAction', 4),
    stat('fighter-20-champion', 'attacks.perAction', 3, {
      definition: {
        classes: [{ classUid: FIGHTER, subclassUid: SUB('champion'), level: 11, order: 0 }],
      },
    }),
  ],
})
add('classes-fighter.json', {
  uid: F('extra-attack-3'),
  effects: [{ type: 'attack.extra', count: 3 }],
  automation: full,
  tests: [stat('fighter-20-champion', 'attacks.perAction', 4)],
})
add('classes-fighter.json', {
  uid: F('indomitable-1-use'),
  effects: [
    resource(
      'indomitable',
      'Indomitable',
      "table('indomitable-uses', classLevel('srd-5.1:class:fighter'))",
      'longRest',
    ),
    manual('Reroll a saving throw that you fail; you must use the new roll.'),
  ],
  automation: partial(['the reroll itself']),
  tests: [stat('fighter-20-champion', 'resource.indomitable.max', 3)],
})
add(
  'classes-fighter.json',
  placeholder(
    F('indomitable-2-uses'),
    'Indomitable can now be used twice between long rests; the resource follows the class table.',
    'Scaling lives on the level-9 feature table.',
  ),
)
add(
  'classes-fighter.json',
  placeholder(
    F('indomitable-3-uses'),
    'Indomitable can now be used three times between long rests; the resource follows the class table.',
    'Scaling lives on the level-9 feature table.',
  ),
)

// champion
add('classes-fighter.json', {
  uid: F('improved-critical'),
  effects: [{ type: 'crit.range', min: 19 }],
  automation: full,
  tests: [stat('fighter-5-champion', 'crit.range', 19)],
})
add('classes-fighter.json', {
  uid: F('remarkable-athlete'),
  effects: [
    ...['athletics', 'acrobatics', 'sleight-of-hand', 'stealth'].map((skill) => ({
      type: 'proficiency.grant',
      kind: 'skill',
      target: skill,
      level: 'half',
    })),
    {
      type: 'bonus',
      target: 'initiative.bonus',
      value: 'floor(PB / 2)',
      note: 'Remarkable Athlete',
    },
    manual(
      'Running long jump distance increases by a number of feet equal to your Strength modifier.',
    ),
  ],
  automation: partial([
    'long jump distance',
    'half proficiency on raw Strength, Dexterity and Constitution checks that are not skills',
  ]),
  tests: [
    stat('fighter-20-champion', 'skill.acrobatics.proficiency', 0.5),
    stat('fighter-20-champion', 'initiative.bonus', 5),
  ],
})
add('classes-fighter.json', {
  uid: F('additional-fighting-style'),
  choices: [fightingStyleChoice('fighting-style', 'Additional Fighting Style')],
  automation: full,
  tests: [stat('fighter-20-champion', 'attack.ranged', 2)],
})
add('classes-fighter.json', {
  uid: F('superior-critical'),
  effects: [{ type: 'crit.range', min: 18 }],
  automation: full,
  tests: [stat('fighter-20-champion', 'crit.range', 18)],
})
add('classes-fighter.json', {
  uid: F('survivor'),
  effects: [
    manual(
      'At the start of each of your turns, regain 5 + your Constitution modifier hit points if you have no more than half your hit points left (and at least 1).',
    ),
  ],
  automation: manualLevel('Turn-start healing is bookkeeping the tracker does not automate yet.'),
})

// ------------------------------------------------------------------------------------ rogue
const ROGUE = CLASS('rogue')
add('classes-rogue.json', {
  uid: F('rogue-expertise-1'),
  choices: [
    { type: 'choice', key: 'expertise', name: 'Expertise', count: 2, from: { kind: 'expertise' } },
  ],
  automation: full,
  tests: [stat('rogue-5-thief', 'skill.stealth.proficiency', 2)],
})
add('classes-rogue.json', {
  uid: F('rogue-expertise-2'),
  choices: [
    { type: 'choice', key: 'expertise', name: 'Expertise', count: 2, from: { kind: 'expertise' } },
  ],
  automation: full,
  tests: [stat('rogue-20-thief', 'skill.acrobatics.proficiency', 2)],
})
add('classes-rogue.json', {
  uid: F('sneak-attack'),
  effects: [
    {
      type: 'action.damageAdd',
      formula: "dice(ceil(classLevel('srd-5.1:class:rogue') / 2), 6)",
      damageType: 'weapon',
      oncePerTurn: 'sneak-attack',
      label: 'Sneak Attack',
      condition: {
        all: [
          { any: [{ leaf: 'ctx.hasAdvantage' }, { leaf: 'ctx.allyAdjacent' }] },
          {
            any: [
              { leaf: 'ctx.weaponProperty', property: 'finesse' },
              { leaf: 'ctx.attackType', type: 'ranged' },
            ],
          },
        ],
      },
    },
  ],
  automation: full,
  tests: [
    plan(
      'rogue-5-thief',
      { kind: 'weapon', itemId: 'rapier' },
      { situation: { hidden: true } },
      { damage: [{ id: 'sneak-attack', formula: '3d6' }], oncePerTurnKeys: ['sneak-attack'] },
    ),
    plan(
      'rogue-5-thief',
      { kind: 'weapon', itemId: 'rapier' },
      { situation: { allyAdjacentToTarget: false } },
      undefined,
      { damageIds: ['sneak-attack'] },
    ),
    plan(
      'rogue-20-thief',
      { kind: 'weapon', itemId: 'rapier' },
      { situation: { hidden: true } },
      { damage: [{ id: 'sneak-attack', formula: '10d6' }] },
    ),
  ],
})
add('classes-rogue.json', {
  uid: F('thieves-cant'),
  effects: [{ type: 'language.grant', language: 'thieves-cant' }],
  automation: full,
  tests: [proficient('rogue-5-thief', 'languages', 'thieves-cant')],
})
add('classes-rogue.json', {
  uid: F('cunning-action'),
  effects: ['Dash', 'Disengage', 'Hide'].map((name) => ({
    type: 'action.grant',
    name: `Cunning Action: ${name}`,
    actionType: 'bonus',
    description: `${name} as a bonus action.`,
  })),
  automation: full,
  tests: [
    plan(
      'rogue-5-thief',
      {
        kind: 'action',
        templateId: 'action:class:srd-5.1:class:rogue@2/feature:cunning-action/cunning-action-dash',
      },
      {},
      { actionType: 'bonus' },
    ),
  ],
})
add(
  'classes-rogue.json',
  placeholder(
    F('roguish-archetype'),
    'Choose a roguish archetype in the builder.',
    'Subclass selection is structural.',
  ),
)
for (const n of [1, 2, 3])
  add(
    'classes-rogue.json',
    placeholder(
      F(`roguish-archetype-improvement-${n}`),
      'Your roguish archetype grants a feature at this level.',
      'Placeholder row; mechanics live on the subclass.',
    ),
  )
for (const n of [1, 2, 3, 4, 5, 6])
  add('classes-rogue.json', {
    uid: F(`rogue-ability-score-improvement-${n}`),
    choices: [asi],
    automation: full,
    tests: [stat('rogue-20-thief', 'ability.dex.score', 20)],
  })
add('classes-rogue.json', {
  uid: F('uncanny-dodge'),
  effects: [
    {
      type: 'action.grant',
      name: 'Uncanny Dodge',
      actionType: 'reaction',
      description: 'Halve the damage of an attack from an attacker you can see.',
    },
    manual('Halve the damage taken from the triggering attack.'),
  ],
  automation: partial(['halving the damage']),
  tests: [
    plan(
      'rogue-5-thief',
      {
        kind: 'action',
        templateId: 'action:class:srd-5.1:class:rogue@5/feature:uncanny-dodge/uncanny-dodge',
      },
      {},
      { actionType: 'reaction' },
    ),
  ],
})
add('classes-rogue.json', {
  uid: F('rogue-evasion'),
  effects: [
    manual(
      'On a Dexterity save against an effect that deals half damage on a success, take no damage on a success and half on a failure.',
    ),
  ],
  automation: manualLevel('Depends on the save outcome, which the engine does not see.'),
})
add('classes-rogue.json', {
  uid: F('reliable-talent'),
  effects: [
    manual(
      'Treat a d20 roll of 9 or lower as a 10 on ability checks that add your proficiency bonus.',
    ),
  ],
  automation: manualLevel('Minimum roll rules need the roll step.'),
})
add('classes-rogue.json', {
  uid: F('blindsense'),
  effects: [{ type: 'sense.grant', sense: 'blindsight', range: 10 }],
  automation: full,
  tests: [stat('rogue-20-thief', 'sense.blindsight', 10)],
})
add('classes-rogue.json', {
  uid: F('slippery-mind'),
  effects: [{ type: 'proficiency.grant', kind: 'save', target: 'wis' }],
  automation: full,
  tests: [stat('rogue-20-thief', 'save.wis.proficiency', 1)],
})
add('classes-rogue.json', {
  uid: F('elusive'),
  effects: [manual('No attack roll has advantage against you while you are not incapacitated.')],
  automation: manualLevel("Advantage against you is the attacker's roll."),
})
add('classes-rogue.json', {
  uid: F('stroke-of-luck'),
  effects: [
    resource('stroke-of-luck', 'Stroke of Luck', 1, 'shortRest'),
    manual('Turn a missed attack into a hit, or a failed ability check into a 20.'),
  ],
  automation: partial(['changing the roll result']),
  tests: [stat('rogue-20-thief', 'resource.stroke-of-luck.max', 1)],
})
// thief
add('classes-rogue.json', {
  uid: F('fast-hands'),
  effects: [
    {
      type: 'action.grant',
      name: 'Fast Hands',
      actionType: 'bonus',
      description: "Sleight of Hand check, thieves' tools, or Use an Object as a bonus action.",
    },
  ],
  automation: partial(['the object interaction itself']),
  tests: [
    plan(
      'rogue-5-thief',
      {
        kind: 'action',
        templateId: 'action:subclass:srd-5.1:subclass:thief@3/feature:fast-hands/fast-hands',
      },
      {},
      { actionType: 'bonus' },
    ),
  ],
})
add('classes-rogue.json', {
  uid: F('second-story-work'),
  effects: [
    manual('Climbing costs no extra movement; running jumps gain your Dexterity modifier in feet.'),
  ],
  automation: manualLevel('Movement costs are not modelled.'),
})
add('classes-rogue.json', {
  uid: F('supreme-sneak'),
  effects: [
    { type: 'advantage', on: 'check.stealth' },
    manual('Only if you move no more than half your speed on the same turn.'),
  ],
  automation: partial(['the half-speed condition']),
  tests: [stat('rogue-20-thief', 'roll.advantage.check.stealth', true)],
})
add('classes-rogue.json', {
  uid: F('use-magic-device'),
  effects: [manual('Ignore class, race and level requirements on the use of magic items.')],
  automation: manualLevel('Item requirements are not enforced yet.'),
})
add('classes-rogue.json', {
  uid: F('thiefs-reflexes'),
  effects: [manual('Take two turns during the first round of combat.')],
  automation: manualLevel("Initiative order is the tracker's job."),
})

// ------------------------------------------------------------------------------------ cleric
const CLERIC = CLASS('cleric')
add('classes-cleric.json', {
  uid: F('spellcasting-cleric'),
  effects: [
    {
      type: 'spellcasting.grant',
      ability: 'wis',
      progression: 'full',
      preparation: 'prepared',
      list: 'srd-5.1:spell_list:cleric',
      ritual: true,
      focus: 'holy symbol',
      preparedFormula: "castingMod + classLevel('srd-5.1:class:cleric')",
    },
  ],
  automation: full,
  tests: [
    stat('cleric-5-life', 'spell.saveDC', 15),
    stat('cleric-5-life', 'spell.slots.3', 2),
    stat('cleric-5-life', 'spell.prepared.max', 9),
    stat('cleric-20-life', 'spell.slots.9', 1),
  ],
})
add(
  'classes-cleric.json',
  placeholder(
    F('divine-domain'),
    'Choose a divine domain in the builder.',
    'Subclass selection is structural.',
  ),
)
for (const n of [1, 2, 3, 4, 5])
  add(
    'classes-cleric.json',
    placeholder(
      F(`domain-spells-${n}`),
      'Your domain spells are always prepared; see the subclass.',
      'Domain spells come from the subclass data.',
    ),
  )
add('classes-cleric.json', {
  uid: F('channel-divinity-1-rest'),
  effects: [
    resource(
      'channel-divinity',
      'Channel Divinity',
      "table('channel-divinity-charges', classLevel('srd-5.1:class:cleric'))",
      'shortRest',
    ),
  ],
  automation: full,
  tests: [
    stat('cleric-5-life', 'resource.channel-divinity.max', 1),
    stat('cleric-20-life', 'resource.channel-divinity.max', 3),
  ],
})
add('classes-cleric.json', {
  uid: F('channel-divinity-turn-undead'),
  effects: [
    {
      type: 'action.grant',
      name: 'Channel Divinity: Turn Undead',
      actionType: 'action',
      save: { ability: 'wis', dc: 'spell', onSuccess: 'none' },
      cost: { resource: 'channel-divinity', amount: 1 },
      description:
        'Each undead within 30 feet that can see or hear you must succeed on a Wisdom save or be turned for 1 minute.',
    },
    manual('Apply the turned condition to each undead that fails.'),
  ],
  automation: partial(['applying the turned condition']),
  tests: [
    plan(
      'cleric-5-life',
      {
        kind: 'action',
        templateId:
          'action:class:srd-5.1:class:cleric@2/feature:channel-divinity-turn-undead/channel-divinity-turn-undead',
      },
      {},
      { save: { ability: 'wis', dc: 15 }, costs: [{ kind: 'resource', id: 'channel-divinity' }] },
    ),
  ],
})
for (const n of [1, 2, 3, 4])
  add(
    'classes-cleric.json',
    placeholder(
      F(`divine-domain-improvement-${n}`),
      'Your divine domain grants a feature at this level.',
      'Placeholder row; mechanics live on the subclass.',
    ),
  )
for (const n of [1, 2, 3, 4, 5])
  add('classes-cleric.json', {
    uid: F(`cleric-ability-score-improvement-${n}`),
    choices: [asi],
    automation: full,
    tests: [stat('cleric-20-life', 'ability.wis.score', 20)],
  })
for (const slug of [
  'destroy-undead-cr-1-2-or-below',
  'destroy-undead-cr-1-or-below',
  'destroy-undead-cr-2-or-below',
  'destroy-undead-cr-3-or-below',
  'destroy-undead-cr-4-or-below',
]) {
  add(
    'classes-cleric.json',
    placeholder(
      F(slug),
      'Undead of the listed challenge rating or lower that fail the Turn Undead save are destroyed.',
      'Turn Undead outcomes are applied by the table.',
    ),
  )
}
add(
  'classes-cleric.json',
  placeholder(
    F('channel-divinity-2-rest'),
    'Channel Divinity can now be used twice between rests; the resource follows the class table.',
    'Scaling lives on the level-2 feature table.',
  ),
)
add(
  'classes-cleric.json',
  placeholder(
    F('channel-divinity-3-rest'),
    'Channel Divinity can now be used three times between rests; the resource follows the class table.',
    'Scaling lives on the level-2 feature table.',
  ),
)
add('classes-cleric.json', {
  uid: F('divine-intervention'),
  effects: [
    resource('divine-intervention', 'Divine Intervention', 1, 'none'),
    manual(
      'Once per 7 days, roll percentile dice; on a roll at or below your cleric level your deity intervenes. Restore the use after 7 days.',
    ),
  ],
  automation: partial(['the percentile check', 'the seven-day recharge']),
  tests: [stat('cleric-20-life', 'resource.divine-intervention.max', 1)],
})
add(
  'classes-cleric.json',
  placeholder(
    F('divine-intervention-improvement'),
    'Divine Intervention succeeds automatically.',
    'See Divine Intervention.',
  ),
)
// life
add('classes-cleric.json', {
  uid: F('bonus-proficiency'),
  effects: [{ type: 'proficiency.grant', kind: 'armor', target: 'heavy-armor' }],
  automation: full,
  tests: [
    proficient('cleric-5-life', 'armor', 'heavy-armor'),
    stat('cleric-5-life', 'speed.walk', 25),
  ],
})
add('classes-cleric.json', {
  uid: F('disciple-of-life'),
  effects: [
    manual("Healing spells of 1st level or higher restore 2 + the spell's level extra hit points."),
  ],
  automation: manualLevel('Healing bonuses have no effect type yet.'),
})
add('classes-cleric.json', {
  uid: F('channel-divinity-preserve-life'),
  effects: [
    {
      type: 'action.grant',
      name: 'Channel Divinity: Preserve Life',
      actionType: 'action',
      healing: "5 * classLevel('srd-5.1:class:cleric')",
      cost: { resource: 'channel-divinity', amount: 1 },
      description:
        'Distribute hit points among creatures within 30 feet, none above half its maximum.',
    },
    manual('Distribute the healing; no creature can go above half its hit point maximum.'),
  ],
  automation: partial(['distributing the healing']),
  tests: [
    plan(
      'cleric-5-life',
      {
        kind: 'action',
        templateId:
          'action:subclass:srd-5.1:subclass:life@2/feature:channel-divinity-preserve-life/channel-divinity-preserve-life',
      },
      {},
      { healing: '25' },
    ),
  ],
})
add('classes-cleric.json', {
  uid: F('blessed-healer'),
  effects: [
    manual(
      "When you cast a healing spell of 1st level or higher on another creature, you regain 2 + the spell's level hit points.",
    ),
  ],
  automation: manualLevel('Healing side effects have no effect type yet.'),
})
add('classes-cleric.json', {
  uid: F('divine-strike'),
  effects: [
    {
      type: 'action.damageAdd',
      formula: '1d8',
      damageType: 'radiant',
      label: 'Divine Strike',
      oncePerTurn: 'divine-strike',
      condition: {
        all: [
          {
            any: [
              { leaf: 'ctx.attackType', type: 'melee' },
              { leaf: 'ctx.attackType', type: 'ranged' },
            ],
          },
          { not: { leaf: 'classLevel', class: CLERIC, gte: 14 } },
        ],
      },
    },
    {
      type: 'action.damageAdd',
      formula: '2d8',
      damageType: 'radiant',
      label: 'Divine Strike',
      oncePerTurn: 'divine-strike',
      condition: {
        all: [
          {
            any: [
              { leaf: 'ctx.attackType', type: 'melee' },
              { leaf: 'ctx.attackType', type: 'ranged' },
            ],
          },
          { leaf: 'classLevel', class: CLERIC, gte: 14 },
        ],
      },
    },
  ],
  automation: full,
  tests: [
    plan(
      'cleric-20-life',
      { kind: 'weapon', itemId: 'mace' },
      {},
      { damage: [{ id: 'divine-strike', formula: '2d8', damageType: 'radiant' }] },
    ),
    plan(
      'cleric-20-life',
      { kind: 'weapon', itemId: 'mace' },
      {},
      { damage: [{ id: 'divine-strike', formula: '1d8' }] },
      undefined,
      {
        definition: {
          classes: [{ classUid: CLERIC, subclassUid: SUB('life'), level: 8, order: 0 }],
        },
      },
    ),
  ],
})
add('classes-cleric.json', {
  uid: F('supreme-healing'),
  effects: [manual('Use the maximum on each healing die instead of rolling.')],
  automation: manualLevel('Maximised healing needs the roll step.'),
})

// ------------------------------------------------------------------------------------ warlock
const WARLOCK = CLASS('warlock')
add(
  'classes-warlock.json',
  placeholder(
    F('otherworldly-patron'),
    'Choose an otherworldly patron in the builder.',
    'Subclass selection is structural.',
  ),
)
add('classes-warlock.json', {
  uid: F('pact-magic'),
  effects: [
    {
      type: 'spellcasting.grant',
      ability: 'cha',
      progression: 'pact',
      preparation: 'known',
      list: 'srd-5.1:spell_list:warlock',
      focus: 'arcane focus',
    },
  ],
  automation: full,
  tests: [
    stat('warlock-5-fiend', 'spell.pact.slots', 2),
    stat('warlock-5-fiend', 'spell.pact.level', 3),
    stat('warlock-20-fiend', 'spell.pact.slots', 4),
    stat('fighter-5-warlock-3', 'spell.pact.level', 2),
  ],
})
add('classes-warlock.json', {
  uid: F('eldritch-invocations'),
  choices: [
    {
      type: 'choice',
      key: 'invocations',
      name: 'Eldritch Invocations',
      count: "table('invocations-known', classLevel('srd-5.1:class:warlock'))",
      from: { kind: 'content', contentKind: 'feature', filter: { tags: ['invocation'] } },
    },
  ],
  automation: full,
  tests: [stat('warlock-5-fiend', 'sense.darkvision', 120)],
})
add('classes-warlock.json', {
  uid: F('pact-boon'),
  choices: [
    {
      type: 'choice',
      key: 'pact-boon',
      name: 'Pact Boon',
      count: 1,
      from: {
        kind: 'optionSet',
        options: [
          { id: 'blade', name: 'Pact of the Blade', feature: F('pact-of-the-blade') },
          { id: 'chain', name: 'Pact of the Chain', feature: F('pact-of-the-chain') },
          { id: 'tome', name: 'Pact of the Tome', feature: F('pact-of-the-tome') },
        ],
      },
    },
  ],
  automation: full,
  tests: [knownSpell('warlock-5-fiend', 'fire-bolt')],
})
add('classes-warlock.json', {
  uid: F('pact-of-the-blade'),
  effects: [
    {
      type: 'action.grant',
      name: 'Create Pact Weapon',
      actionType: 'action',
      description:
        'Create a pact weapon in your empty hand; you are proficient with it and it counts as magical.',
    },
    manual('Add the pact weapon to the inventory; it is proficient and magical.'),
  ],
  automation: partial(['the weapon itself']),
  tests: [
    plan(
      'warlock-20-fiend',
      {
        kind: 'action',
        templateId:
          'action:class:srd-5.1:class:warlock@3/feature:pact-boon/feature:pact-of-the-blade/create-pact-weapon',
      },
      {},
      { actionType: 'action' },
    ),
  ],
})
add('classes-warlock.json', {
  uid: F('pact-of-the-chain'),
  effects: [
    grantSpell('find-familiar', { atWill: false, uses: { max: 1, recharge: 'none' } }),
    manual('Cast find familiar as a ritual; special familiar forms are available.'),
  ],
  automation: partial(['the familiar itself']),
  tests: [
    {
      given: {
        fixture: 'warlock-5-fiend',
        modify: {
          definition: {
            choices: {
              'class:srd-5.1:class:warlock@3/feature:pact-boon/pact-boon': {
                kind: 'optionSet',
                options: ['chain'],
              },
            },
          },
        },
      },
      expect: { knownSpell: SPELL('find-familiar') },
    },
  ],
})
add('classes-warlock.json', {
  uid: F('pact-of-the-tome'),
  choices: [
    {
      type: 'choice',
      key: 'cantrips',
      name: 'Book of Shadows cantrips',
      count: 3,
      from: { kind: 'content', contentKind: 'spell', filter: { level: 0 } },
    },
  ],
  automation: full,
  tests: [knownSpell('warlock-5-fiend', 'guidance')],
})
for (const n of [1, 2, 3, 4, 5])
  add('classes-warlock.json', {
    uid: F(`warlock-ability-score-improvement-${n}`),
    choices: [asi],
    automation: full,
    tests: [stat('warlock-20-fiend', 'ability.cha.score', 20)],
  })
for (const n of [1, 2, 3])
  add(
    'classes-warlock.json',
    placeholder(
      F(`otherworldly-patron-improvement-${n}`),
      'Your patron grants a feature at this level.',
      'Placeholder row; mechanics live on the subclass.',
    ),
  )
for (const [slug, level] of [
  ['mystic-arcanum-6th-level', 6],
  ['mystic-arcanum-7th-level', 7],
  ['mystic-arcanum-8th-level', 8],
  ['mystic-arcanum-9th-level', 9],
]) {
  add('classes-warlock.json', {
    uid: F(slug),
    effects: [
      resource(`mystic-arcanum-${level}`, `Mystic Arcanum (${level}th level)`, 1, 'longRest'),
    ],
    choices: [
      {
        type: 'choice',
        key: 'arcanum',
        name: `Mystic Arcanum (${level}th level)`,
        count: 1,
        from: {
          kind: 'content',
          contentKind: 'spell',
          filter: { list: 'srd-5.1:spell_list:warlock', level },
        },
      },
    ],
    automation: partial(['casting the arcanum without a slot']),
    tests: [
      stat('warlock-20-fiend', `resource.mystic-arcanum-${level}.max`, 1),
      knownSpell(
        'warlock-20-fiend',
        { 6: 'circle-of-death', 7: 'finger-of-death', 8: 'dominate-monster', 9: 'foresight' }[
          level
        ],
      ),
    ],
  })
}
add('classes-warlock.json', {
  uid: F('eldritch-master'),
  effects: [
    resource('eldritch-master', 'Eldritch Master', 1, 'longRest'),
    manual('Spend 1 minute entreating your patron to regain all expended Pact Magic spell slots.'),
  ],
  automation: partial(['regaining the pact slots']),
  tests: [stat('warlock-20-fiend', 'resource.eldritch-master.max', 1)],
})
// fiend
add('classes-warlock.json', {
  uid: F('dark-ones-blessing'),
  effects: [
    manual(
      'When you reduce a hostile creature to 0 hit points, gain temporary hit points equal to your Charisma modifier + your warlock level.',
    ),
  ],
  automation: manualLevel('Kill triggers are not observed by the engine.'),
})
add('classes-warlock.json', {
  uid: F('dark-ones-own-luck'),
  effects: [
    resource('dark-ones-own-luck', "Dark One's Own Luck", 1, 'shortRest'),
    manual('Add a d10 to an ability check or saving throw.'),
  ],
  automation: partial(['adding the d10']),
  tests: [stat('warlock-20-fiend', 'resource.dark-ones-own-luck.max', 1)],
})
add('classes-warlock.json', {
  uid: F('fiendish-resilience'),
  choices: [
    {
      type: 'choice',
      key: 'resistance',
      name: 'Fiendish Resilience',
      count: 1,
      from: {
        kind: 'optionSet',
        options: [
          'acid',
          'bludgeoning',
          'cold',
          'fire',
          'force',
          'lightning',
          'necrotic',
          'piercing',
          'poison',
          'psychic',
          'radiant',
          'slashing',
          'thunder',
        ].map((t) => ({
          id: t,
          name: t.charAt(0).toUpperCase() + t.slice(1),
          effects: [
            {
              type: 'damage.resistance',
              damageType: t,
              condition: {
                not: { any: [{ leaf: 'packet.magical' }, { leaf: 'packet.silvered' }] },
              },
            },
          ],
        })),
      },
    },
  ],
  automation: full,
  tests: [defense('warlock-20-fiend', 'resistance', 'fire')],
})
add('classes-warlock.json', {
  uid: F('hurl-through-hell'),
  effects: [
    resource('hurl-through-hell', 'Hurl Through Hell', 1, 'longRest'),
    manual(
      'When you hit with an attack, the target vanishes until the end of your next turn and takes 10d10 psychic damage if not a fiend.',
    ),
  ],
  automation: partial(['the banishment and its damage']),
  tests: [stat('warlock-20-fiend', 'resource.hurl-through-hell.max', 1)],
})
// invocations
const invocation = (slug, effects, automation, tests = []) => {
  const granted = effects.filter((e) => e.type === 'spell.grant').map((e) => e.spell)
  const auto = granted.map((spellUid) => ({
    name: `${slug} grants ${spellUid.split(':')[2]}`,
    given: {
      fixture: 'warlock-5-fiend',
      modify: {
        definition: {
          choices: {
            'class:srd-5.1:class:warlock@2/feature:eldritch-invocations/invocations': {
              kind: 'content',
              entries: [F(`eldritch-invocation-${slug}`)],
            },
          },
        },
      },
    },
    expect: { knownSpell: spellUid },
  }))
  add('classes-warlock.json', {
    uid: F(`eldritch-invocation-${slug}`),
    effects,
    automation,
    tests: [...tests, ...auto],
    tags: ['invocation'],
  })
}
invocation(
  'agonizing-blast',
  [
    {
      type: 'action.damageAdd',
      formula: 'CHA',
      damageType: 'force',
      label: 'Agonizing Blast',
      appliesTo: 'spell',
      condition: { leaf: 'ctx.spell', spell: SPELL('eldritch-blast') },
    },
  ],
  full,
  [
    plan(
      'warlock-5-fiend',
      { kind: 'spell', spellUid: SPELL('eldritch-blast') },
      {},
      { damage: [{ id: 'agonizing-blast', formula: '4', damageType: 'force' }] },
    ),
    plan('warlock-5-fiend', { kind: 'spell', spellUid: SPELL('burning-hands') }, {}, undefined, {
      damageIds: ['agonizing-blast'],
    }),
  ],
)
invocation('armor-of-shadows', [atWill('mage-armor')], full, [
  knownSpell('warlock-20-fiend', 'mage-armor'),
])
invocation('beast-speech', [atWill('speak-with-animals')], full)
invocation(
  'beguiling-influence',
  [
    { type: 'proficiency.grant', kind: 'skill', target: 'deception' },
    { type: 'proficiency.grant', kind: 'skill', target: 'persuasion' },
  ],
  full,
  [stat('warlock-20-fiend', 'skill.persuasion.proficiency', 1)],
)
invocation(
  'book-of-ancient-secrets',
  [manual('Inscribe ritual spells in your Book of Shadows and cast them as rituals.')],
  manualLevel('Ritual books are tracked by the player.'),
)
invocation(
  'devils-sight',
  [
    { type: 'sense.grant', sense: 'darkvision', range: 120 },
    manual('You see normally in magical darkness too.'),
  ],
  partial(['magical darkness']),
  [stat('warlock-5-fiend', 'sense.darkvision', 120)],
)
invocation('eldritch-sight', [atWill('detect-magic')], full)
invocation(
  'eldritch-spear',
  [manual('Eldritch blast has a range of 300 feet.')],
  manualLevel('Spell range changes are not modelled.'),
)
invocation(
  'eyes-of-the-rune-keeper',
  [manual('You can read all writing.')],
  manualLevel('Narrative.'),
)
invocation('fiendish-vigor', [atWill('false-life')], full)
invocation(
  'gaze-of-two-minds',
  [manual('Perceive through the senses of a willing humanoid you touch.')],
  manualLevel('Narrative.'),
)
invocation('mask-of-many-faces', [atWill('disguise-self')], full)
invocation('misty-visions', [atWill('silent-image')], full)
invocation(
  'repelling-blast',
  [manual('Eldritch blast pushes a hit creature up to 10 feet away.')],
  manualLevel("Forced movement is the tracker's job."),
)
invocation('thief-of-five-fates', [oncePerLongRest('bane')], full)
invocation(
  'voice-of-the-chain-master',
  [
    manual(
      'Communicate telepathically with your familiar and perceive through its senses at any distance on the same plane.',
    ),
  ],
  manualLevel('Narrative.'),
)
invocation('mire-the-mind', [oncePerLongRest('slow')], full)
invocation(
  'one-with-shadows',
  [manual('In dim light or darkness, become invisible until you move or act.')],
  manualLevel('Lighting is not modelled.'),
)
invocation('sign-of-ill-omen', [oncePerLongRest('bestow-curse')], full)
invocation(
  'thirsting-blade',
  [
    {
      type: 'attack.extra',
      count: 1,
      condition: { leaf: 'hasFeature', feature: F('pact-of-the-blade') },
    },
    manual('Only with your pact weapon.'),
  ],
  partial(['pact-weapon restriction']),
  [stat('warlock-20-fiend', 'attacks.perAction', 2)],
)
invocation('bewitching-whispers', [oncePerLongRest('compulsion')], full)
invocation('dreadful-word', [oncePerLongRest('confusion')], full)
invocation('sculptor-of-flesh', [oncePerLongRest('polymorph')], full)
invocation('ascendant-step', [atWill('levitate')], full)
invocation('minions-of-chaos', [oncePerLongRest('conjure-elemental')], full)
invocation('otherworldly-leap', [atWill('jump')], full)
invocation('whispers-of-the-grave', [atWill('speak-with-dead')], full)
invocation(
  'lifedrinker',
  [
    {
      type: 'action.damageAdd',
      formula: 'CHA',
      damageType: 'necrotic',
      label: 'Lifedrinker',
      appliesTo: 'melee',
      condition: { leaf: 'hasFeature', feature: F('pact-of-the-blade') },
    },
    manual('Only with your pact weapon.'),
  ],
  partial(['pact-weapon restriction']),
  [
    plan(
      'warlock-20-fiend',
      { kind: 'weapon', itemId: 'pact-sword' },
      {},
      { damage: [{ id: 'lifedrinker', formula: '5', damageType: 'necrotic' }] },
    ),
  ],
)
invocation(
  'chains-of-carceri',
  [
    grantSpell('hold-monster', { atWill: true }),
    manual('Only against celestials, fiends and elementals; once per long rest per creature.'),
  ],
  partial(['target restriction']),
)
invocation('master-of-myriad-forms', [atWill('alter-self')], full)
invocation('visions-of-distant-realms', [atWill('arcane-eye')], full)
invocation(
  'witch-sight',
  [
    manual(
      'See the true form of shapechangers and creatures concealed by illusion or transmutation within 30 feet.',
    ),
  ],
  manualLevel('Narrative.'),
)

// ------------------------------------------------------------------------------------ species
add('species.json', {
  uid: SPECIES('human'),
  effects: ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((ability) => ({
    type: 'abilityScore.bonus',
    ability,
    value: 1,
  })),
  automation: full,
  tests: [stat('fighter-1', 'ability.str.score', 16)],
})
add('species.json', {
  uid: SPECIES('dwarf'),
  effects: [{ type: 'abilityScore.bonus', ability: 'con', value: 2 }],
  automation: full,
  tests: [stat('cleric-5-life', 'ability.con.score', 16)],
})
add('species.json', {
  uid: SPECIES('hill-dwarf'),
  effects: [{ type: 'abilityScore.bonus', ability: 'wis', value: 1 }],
  automation: full,
  tests: [stat('cleric-5-life', 'ability.wis.score', 18)],
})
add('species.json', {
  uid: SPECIES('elf'),
  effects: [{ type: 'abilityScore.bonus', ability: 'dex', value: 2 }],
  automation: full,
  tests: [stat('rogue-5-thief', 'ability.dex.score', 20)],
})
add('species.json', {
  uid: SPECIES('high-elf'),
  effects: [{ type: 'abilityScore.bonus', ability: 'int', value: 1 }],
  automation: full,
  tests: [stat('rogue-5-thief', 'ability.int.score', 13)],
})
add('species.json', {
  uid: F('darkvision'),
  effects: [{ type: 'sense.grant', sense: 'darkvision', range: 60 }],
  automation: full,
  tests: [
    stat('cleric-5-life', 'sense.darkvision', 60),
    stat('rogue-5-thief', 'sense.darkvision', 60),
  ],
})
add('species.json', {
  uid: F('dwarven-resilience'),
  effects: [
    { type: 'advantage', on: 'save.vs.poison' },
    { type: 'damage.resistance', damageType: 'poison' },
  ],
  automation: full,
  tests: [
    stat('cleric-5-life', 'roll.advantage.save.vs.poison', true),
    defense('cleric-5-life', 'resistance', 'poison'),
  ],
})
add('species.json', {
  uid: F('stonecunning'),
  effects: [manual('Add double your proficiency bonus to History checks about stonework.')],
  automation: manualLevel('Context-specific check bonuses are decided at the table.'),
})
add('species.json', {
  uid: F('dwarven-combat-training'),
  effects: ['battleaxe', 'handaxe', 'light-hammer', 'warhammer'].map((w) => ({
    type: 'proficiency.grant',
    kind: 'weapon',
    target: w,
  })),
  automation: full,
  tests: [proficient('cleric-5-life', 'weapons', 'warhammer')],
})
add('species.json', {
  uid: F('tool-proficiency'),
  choices: [
    {
      type: 'choice',
      key: 'tool',
      name: "Artisan's tools",
      count: 1,
      from: { kind: 'tool', from: ['smiths-tools', 'brewers-supplies', 'masons-tools'] },
    },
  ],
  automation: full,
  tests: [proficient('cleric-5-life', 'tools', 'smiths-tools')],
})
add('species.json', {
  uid: F('dwarven-toughness'),
  effects: [{ type: 'hp.bonusPerLevel', value: 1 }],
  automation: full,
  tests: [stat('cleric-5-life', 'hp.max', 48)],
})
add('species.json', {
  uid: F('fey-ancestry'),
  effects: [{ type: 'advantage', on: 'save.vs.charmed' }, manual('Magic cannot put you to sleep.')],
  automation: partial(['immunity to magical sleep']),
  tests: [stat('rogue-5-thief', 'roll.advantage.save.vs.charmed', true)],
})
add('species.json', {
  uid: F('trance'),
  effects: [manual('You meditate 4 hours instead of sleeping 8.')],
  automation: manualLevel('Rest duration is narrative.'),
})
add('species.json', {
  uid: F('keen-senses'),
  effects: [{ type: 'proficiency.grant', kind: 'skill', target: 'perception' }],
  automation: full,
  tests: [atLeast('rogue-5-thief', 'skill.perception.proficiency', 1)],
})
add('species.json', {
  uid: F('elf-weapon-training'),
  effects: ['longsword', 'shortsword', 'shortbow', 'longbow'].map((w) => ({
    type: 'proficiency.grant',
    kind: 'weapon',
    target: w,
  })),
  automation: full,
  tests: [proficient('rogue-5-thief', 'weapons', 'longsword')],
})
add('species.json', {
  uid: F('high-elf-cantrip'),
  choices: [
    {
      type: 'choice',
      key: 'cantrip',
      name: 'Wizard cantrip',
      count: 1,
      from: {
        kind: 'content',
        contentKind: 'spell',
        filter: { list: 'srd-5.1:spell_list:wizard', level: 0 },
      },
    },
  ],
  automation: partial(['Intelligence as the casting ability for this cantrip']),
  tests: [knownSpell('rogue-5-thief', 'fire-bolt')],
})
add('species.json', {
  uid: F('extra-language'),
  choices: [
    {
      type: 'choice',
      key: 'language',
      name: 'Extra language',
      count: 1,
      from: { kind: 'language' },
    },
  ],
  automation: full,
  tests: [proficient('rogue-5-thief', 'languages', 'dwarvish')],
})

// ------------------------------------------------------------------------------------ background, feat
add('backgrounds-feats.json', {
  uid: 'srd-5.1:background:acolyte',
  automation: full,
  tests: [
    stat('fighter-1', 'skill.insight.proficiency', 1),
    stat('fighter-1', 'skill.religion.proficiency', 1),
    proficient('fighter-1', 'languages', 'celestial'),
  ],
})
add('backgrounds-feats.json', {
  uid: 'srd-5.1:feat:grappler',
  effects: [
    {
      type: 'action.advantage',
      appliesTo: 'melee',
      condition: { leaf: 'ctx.targetHasCondition', condition: 'grappled' },
    },
    manual('Pin: use your action to restrain both you and a creature you are grappling.'),
  ],
  automation: partial(['pinning']),
  tests: [
    plan(
      'fighter-20-champion',
      { kind: 'weapon', itemId: 'longsword-1' },
      { target: { conditions: ['grappled'] } },
      { attack: { mode: 'advantage' } },
    ),
  ],
})

// ------------------------------------------------------------------------------------ classes, subclasses, monsters (structural)
add('classes-fighter.json', {
  uid: FIGHTER,
  automation: full,
  tests: [
    stat('fighter-1', 'hitDice.d10.max', 1),
    stat('fighter-1', 'save.str.proficiency', 1),
    proficient('fighter-1', 'armor', 'all-armor'),
  ],
})
add('classes-fighter.json', {
  uid: SUB('champion'),
  automation: full,
  tests: [stat('fighter-5-champion', 'crit.range', 19)],
})
add('classes-rogue.json', {
  uid: ROGUE,
  automation: full,
  tests: [
    stat('rogue-5-thief', 'hitDice.d8.max', 5),
    stat('rogue-5-thief', 'save.dex.proficiency', 1),
    proficient('rogue-5-thief', 'tools', 'thieves-tools'),
  ],
})
add('classes-rogue.json', {
  uid: SUB('thief'),
  automation: full,
  tests: [stat('rogue-20-thief', 'roll.advantage.check.stealth', true)],
})
add('classes-cleric.json', {
  uid: CLERIC,
  automation: full,
  tests: [
    stat('cleric-5-life', 'hitDice.d8.max', 5),
    stat('cleric-5-life', 'spell.slots.1', 4),
    proficient('cleric-5-life', 'armor', 'medium-armor'),
  ],
})
add('classes-cleric.json', {
  uid: SUB('life'),
  automation: full,
  tests: [knownSpell('cleric-5-life', 'bless'), knownSpell('cleric-5-life', 'revivify')],
})
add('classes-warlock.json', {
  uid: WARLOCK,
  automation: full,
  tests: [
    stat('warlock-5-fiend', 'hitDice.d8.max', 5),
    stat('warlock-5-fiend', 'spell.pact.slots', 2),
    stat('warlock-5-fiend', 'save.cha.proficiency', 1),
  ],
})
add('classes-warlock.json', {
  uid: SUB('fiend'),
  automation: full,
  tests: [
    knownSpell('warlock-5-fiend', 'burning-hands'),
    knownSpell('warlock-5-fiend', 'fireball'),
  ],
})
for (const m of [
  'skeleton',
  'zombie',
  'goblin',
  'wolf',
  'orc',
  'bandit',
  'ogre',
  'giant-spider',
  'ghoul',
  'hobgoblin',
  'bugbear',
  'cultist',
]) {
  add('monsters.json', {
    uid: `srd-5.1:monster:${m}`,
    automation: partial([
      'actions are resolved by the encounter tracker (M2.8)',
      'traits and special abilities',
    ]),
    tags: ['alpha'],
  })
}

// ------------------------------------------------------------------------------------ items
const benchWeapon = (slug, bonus) =>
  plan('item-bench', { kind: 'weapon', itemId: 'bench' }, {}, { attack: { bonus } }, undefined, {
    inventory: [{ id: 'bench', itemUid: ITEM(slug), quantity: 1, equipped: true, attuned: true }],
  })
add('items.json', {
  uid: ITEM('shield'),
  automation: full,
  tests: [
    stat('item-bench', 'ac.bonus', 2, {
      inventory: [
        { id: 'bench', itemUid: ITEM('shield'), quantity: 1, equipped: true, attuned: false },
      ],
    }),
  ],
})
add('items.json', {
  uid: ITEM('ring-of-protection'),
  effects: [
    {
      type: 'bonus',
      target: 'ac.bonus',
      value: 1,
      stackKey: 'ring-of-protection',
      note: 'Ring of Protection',
    },
    ...['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => ({
      type: 'bonus',
      target: `save.${a}.bonus`,
      value: 1,
      stackKey: 'ring-of-protection',
      note: 'Ring of Protection',
    })),
  ],
  automation: full,
  tests: [stat('warlock-20-fiend', 'ac.bonus', 1), stat('warlock-20-fiend', 'save.int.bonus', 1)],
})
add('items.json', {
  uid: ITEM('headband-of-intellect'),
  effects: [{ type: 'abilityScore.atLeast', ability: 'int', value: 19 }],
  automation: full,
  tests: [stat('fighter-20-champion', 'ability.int.score', 19)],
})
add('items.json', {
  uid: ITEM('gauntlets-of-ogre-power'),
  effects: [{ type: 'abilityScore.atLeast', ability: 'str', value: 19 }],
  automation: full,
  tests: [stat('rogue-20-thief', 'ability.str.score', 19)],
})
add('items.json', {
  uid: ITEM('mace-of-disruption'),
  data: {
    category: 'weapon',
    weapon: {
      category: 'simple',
      range: 'melee',
      damage: { dice: '1d6', damageType: 'bludgeoning' },
      properties: ['magical'],
    },
  },
  effects: [
    {
      type: 'action.damageAdd',
      formula: '2d6',
      damageType: 'radiant',
      label: 'Disruption',
      condition: { leaf: 'ctx.targetType', types: ['fiend', 'undead'] },
    },
    manual(
      'A fiend or undead with 25 hit points or fewer after the hit must succeed on a DC 15 Wisdom save or be destroyed; on a success it is frightened until the end of your next turn. The mace sheds bright light in a 20-foot radius.',
    ),
  ],
  automation: partial(['the destroy/frighten save', 'light']),
  tests: [
    plan(
      'cleric-20-life',
      { kind: 'weapon', itemId: 'disruption' },
      { target: { creatureType: 'undead' } },
      { damage: [{ id: 'disruption', formula: '2d6', damageType: 'radiant' }] },
    ),
    plan(
      'cleric-20-life',
      { kind: 'weapon', itemId: 'disruption' },
      { target: { creatureType: 'humanoid' } },
      undefined,
      { damageIds: ['disruption'] },
    ),
  ],
})
add('items.json', {
  uid: ITEM('wand-of-magic-missiles'),
  data: {
    charges: {
      max: 7,
      recharge: { time: 'dawn', formula: '1d6 + 1' },
      destroyedOnLastCharge:
        'If you expend the last charge, roll a d20; on a 1 the wand crumbles into ashes.',
    },
  },
  effects: [
    {
      type: 'action.grant',
      name: 'Magic Missile (wand)',
      actionType: 'action',
      damage: [{ formula: '3d4 + 3', damageType: 'force' }],
      cost: { charges: 1 },
      description:
        'Cast magic missile (three darts) for 1 charge; spend more charges to cast at a higher level.',
    },
    manual('Spending extra charges adds one dart (1d4 + 1 force) per charge.'),
  ],
  automation: partial(['higher-level casting with more charges']),
  tests: [
    plan(
      'cleric-20-life',
      { kind: 'action', templateId: 'action:item:wand/magic-missile-wand' },
      {},
      {
        costs: [{ kind: 'charges', amount: 1, available: 7 }],
        damage: [{ id: 'damage-0', formula: '3d4 + 3', damageType: 'force' }],
      },
    ),
  ],
})
for (const n of [1, 2, 3]) {
  add('items.json', {
    uid: ITEM(`weapon-${n}`),
    effects: [manual(`Use the concrete +${n} weapon entries (for example Longsword +${n}).`)],
    automation: manualLevel('Generic template; concrete variants are generated per weapon.'),
  })
  add('items.json', {
    uid: ITEM(`armor-${n}`),
    effects: [manual(`Use the concrete +${n} armor entries (for example Chain Mail +${n}).`)],
    automation: manualLevel('Generic template; concrete variants are generated per armor.'),
  })
}
void benchWeapon

// ------------------------------------------------------------------------------------ spells (D-1)
// Every SRD spell with typed damage in the upstream data gets an honest classification and a
// behavioural case through the real planner: the attack roll or save DC and the damage packet
// (with slot or character-level scaling) are automated; target choice, extra darts or rays
// from higher slots, later-turn damage, conditions and the rest of the text stay manual.
const SPELL_SOURCE = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.data',
  'srd-source',
  '5e-SRD-Spells.json',
)
const highestAtMost = (table, atMost) => {
  if (!table) return undefined
  let best
  for (const key of Object.keys(table)) {
    const n = Number(key)
    if (Number.isNaN(n) || n > atMost) continue
    if (best === undefined || n > best) best = n
  }
  return best === undefined ? undefined : table[String(best)]
}
if (fs.existsSync(SPELL_SOURCE)) {
  const raw = JSON.parse(fs.readFileSync(SPELL_SOURCE, 'utf8'))
  const spells = Array.isArray(raw) ? raw : raw.results
  let count = 0
  for (const s of spells) {
    const entries = Array.isArray(s.damage) ? s.damage : s.damage ? [s.damage] : []
    if (entries.length === 0) continue
    const typed = entries.filter((d) => d.damage_type)
    const slug = s.index
    const level = Number(s.level)
    if (typed.length === 0) {
      add('spells-damage.json', {
        uid: SPELL(slug),
        automation: manualLevel(
          slug === 'sleep'
            ? 'The dice are a hit-point pool of creatures affected, not damage; applied by hand.'
            : 'The damage type is decided at random by the text; applied by hand.',
        ),
      })
      continue
    }
    const higher = (s.higher_level ?? []).join(' ')
    const text = `${(s.desc ?? []).join(' ')} ${higher}`
    const manualParts = []
    if (!s.attack_type && !s.dc)
      manualParts.push('when the damage applies (no attack roll or saving throw in the data)')
    if (s.area_of_effect)
      manualParts.push(
        `choosing every creature in the ${s.area_of_effect.size}-foot ${s.area_of_effect.type} and applying the result to each`,
      )
    else manualParts.push('applying the result to each target')
    if (
      /additional (ray|dart|beam|bolt|target|creature)|one more (dart|ray|beam)|creates? (one|two|three) more/i.test(
        higher,
      )
    )
      manualParts.push('extra darts, rays or targets from a higher slot (repeat the single packet)')
    if (
      /on each of your turns|start of each of its turns|end of each of its turns|each round|subsequent turns|on later turns/i.test(
        text,
      )
    )
      manualParts.push('damage on later turns')
    if (
      /\b(blinded|charmed|deafened|frightened|grappled|incapacitated|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious)\b/i.test(
        text,
      )
    )
      manualParts.push('the condition it imposes')
    if (/speed is (reduced|halved)|pushed|knocked|half its speed|can't take reactions/i.test(text))
      manualParts.push('movement or other effects in the text')
    const automated = s.attack_type
      ? 'the spell attack roll'
      : s.dc
        ? `the ${String(s.dc.dc_type.index).toUpperCase()} save against the caster's DC`
        : null
    const dmgAt = (d, slotLevel, charLevel) =>
      d.damage_at_slot_level?.[String(slotLevel)] ??
      highestAtMost(d.damage_at_slot_level, slotLevel) ??
      (level === 0 ? highestAtMost(d.damage_at_character_level, charLevel) : undefined)
    const contains = (slotLevel, charLevel) => ({
      damage: typed
        .map((d) => ({ formula: dmgAt(d, slotLevel, charLevel), damageType: d.damage_type.index }))
        .filter((d) => d.formula),
      ...(s.dc
        ? {
            save: {
              ability: s.dc.dc_type.index,
              onSuccess:
                s.dc.dc_success === 'half'
                  ? 'half'
                  : s.dc.dc_success === 'none'
                    ? 'none'
                    : 'special',
            },
          }
        : {}),
    })
    const ref = (slotLevel) => ({
      kind: 'spell',
      spellUid: SPELL(slug),
      ...(level > 0 ? { slotLevel } : {}),
    })
    const tests = []
    const base = contains(level, 20)
    if (base.damage.length > 0) tests.push(plan('cleric-20-life', ref(level), {}, base))
    if (level > 0 && typed.some((d) => d.damage_at_slot_level?.[String(level + 1)])) {
      const up = contains(level + 1, 20)
      if (up.damage.length > 0) tests.push(plan('cleric-20-life', ref(level + 1), {}, up))
    }
    if (level === 0) {
      const low = contains(0, 5)
      if (low.damage.length > 0) tests.push(plan('cleric-5-life', ref(0), {}, low))
    }
    if (tests.length === 0) {
      add('spells-damage.json', {
        uid: SPELL(slug),
        automation: manualLevel(
          "The damage table has no entry at the spell's own level; applied by hand.",
        ),
      })
      continue
    }
    add('spells-damage.json', {
      uid: SPELL(slug),
      automation: partial(
        manualParts,
        `Automated: ${automated ? `${automated}, ` : ''}the ${typed.map((d) => d.damage_type.index).join(' and ')} damage dice with slot or character-level scaling, the slot cost${s.concentration ? ', concentration' : ''}.`,
      ),
      tests,
    })
    count += 1
  }
  console.log(`spells-damage.json: ${count} damage spells classified`)
} else {
  console.warn(`spell source not found at ${SPELL_SOURCE}; spells-damage.json not regenerated`)
}

// ------------------------------------------------------------------------------------ write overlays
for (const [file, entries] of Object.entries(overlays)) {
  fs.writeFileSync(path.join(out, file), JSON.stringify(entries, null, 2) + '\n')
  console.log(`${file}: ${entries.length} overlays`)
}

// ------------------------------------------------------------------------------------ alpha manifest and allow-list
const alpha = {
  classes: [CLASS('fighter'), CLASS('rogue'), CLASS('cleric'), CLASS('warlock')],
  subclasses: [SUB('champion'), SUB('thief'), SUB('life'), SUB('fiend')],
  species: [
    SPECIES('human'),
    SPECIES('dwarf'),
    SPECIES('hill-dwarf'),
    SPECIES('elf'),
    SPECIES('high-elf'),
  ],
  backgrounds: ['srd-5.1:background:acolyte'],
  feats: ['srd-5.1:feat:grappler'],
  items: [
    ITEM('shield'),
    ITEM('ring-of-protection'),
    ITEM('headband-of-intellect'),
    ITEM('gauntlets-of-ogre-power'),
    ITEM('mace-of-disruption'),
    ITEM('wand-of-magic-missiles'),
    ITEM('longsword-1'),
  ],
  monsters: [
    'skeleton',
    'zombie',
    'goblin',
    'wolf',
    'orc',
    'bandit',
    'ogre',
    'giant-spider',
    'ghoul',
    'hobgoblin',
    'bugbear',
    'cultist',
  ].map((m) => `srd-5.1:monster:${m}`),
}
fs.writeFileSync(path.join(out, 'alpha.json'), JSON.stringify(alpha, null, 2) + '\n')

// Every `manual` feature in the alpha set, with the reason, for the owner's review.
const manualReasons = {}
for (const entries of Object.values(overlays)) {
  for (const e of entries) {
    if (e.automation?.level === 'manual')
      manualReasons[e.uid] = e.automation.notes ?? 'Descriptive only.'
  }
}
fs.writeFileSync(
  path.join(out, 'manual-allowlist.json'),
  JSON.stringify(
    Object.entries(manualReasons).map(([uid, reason]) => ({ uid, reason })),
    null,
    2,
  ) + '\n',
)
console.log(`manual allow-list: ${Object.keys(manualReasons).length} entries`)

// ------------------------------------------------------------------------------------ fixtures
const fixture = (name, body) =>
  fs.writeFileSync(path.join(out, 'fixtures', `${name}.json`), JSON.stringify(body, null, 2) + '\n')
const item = (id, slug, extra = {}) => ({
  id,
  itemUid: ITEM(slug),
  quantity: 1,
  equipped: true,
  attuned: false,
  ...extra,
})
const asiKey = (cls, level, slug) =>
  `class:${CLASS(cls)}@${level}/feature:${F(slug).split(':')[2]}/asi`

fixture('fighter-1', {
  name: 'Bram (Fighter 1, human, acolyte)',
  definition: {
    baseAbilities: { str: 15, dex: 13, con: 13, int: 8, wis: 11, cha: 9 },
    speciesUid: SPECIES('human'),
    backgroundUid: 'srd-5.1:background:acolyte',
    classes: [{ classUid: FIGHTER, level: 1, order: 0 }],
    choices: {
      [`class:${FIGHTER}@1/skills`]: { kind: 'skill', skills: ['athletics', 'perception'] },
      [`class:${FIGHTER}@1/feature:fighter-fighting-style/fighting-style`]: {
        kind: 'optionSet',
        options: ['defense'],
      },
      'background:srd-5.1:background:acolyte/languages': {
        kind: 'language',
        languages: ['celestial', 'infernal'],
      },
    },
  },
  inventory: [item('mail', 'chain-mail'), item('shield', 'shield'), item('longsword', 'longsword')],
})

const championChoices = (level) => ({
  [`class:${FIGHTER}@1/skills`]: { kind: 'skill', skills: ['athletics', 'perception'] },
  [`class:${FIGHTER}@1/feature:fighter-fighting-style/fighting-style`]: {
    kind: 'optionSet',
    options: ['defense'],
  },
  'species:srd-5.1:species:dwarf/feature:tool-proficiency/tool': {
    kind: 'tool',
    tools: ['smiths-tools'],
  },
  ...(level >= 4
    ? {
        [asiKey('fighter', 4, 'fighter-ability-score-improvement-1')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { str: 2 },
        },
      }
    : {}),
  ...(level >= 6
    ? {
        [asiKey('fighter', 6, 'fighter-ability-score-improvement-2')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { str: 2 },
        },
      }
    : {}),
  ...(level >= 8
    ? {
        [asiKey('fighter', 8, 'fighter-ability-score-improvement-3')]: {
          kind: 'asiOrFeat',
          choice: 'feat',
          feat: 'srd-5.1:feat:grappler',
        },
      }
    : {}),
  ...(level >= 10
    ? {
        [`subclass:${SUB('champion')}@10/feature:additional-fighting-style/fighting-style`]: {
          kind: 'optionSet',
          options: ['archery'],
        },
      }
    : {}),
  ...(level >= 12
    ? {
        [asiKey('fighter', 12, 'fighter-ability-score-improvement-4')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { con: 2 },
        },
      }
    : {}),
  ...(level >= 14
    ? {
        [asiKey('fighter', 14, 'fighter-ability-score-improvement-5')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { dex: 2 },
        },
      }
    : {}),
  ...(level >= 16
    ? {
        [asiKey('fighter', 16, 'fighter-ability-score-improvement-6')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { wis: 2 },
        },
      }
    : {}),
  ...(level >= 19
    ? {
        [asiKey('fighter', 19, 'fighter-ability-score-improvement-7')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { con: 2 },
        },
      }
    : {}),
})
fixture('fighter-5-champion', {
  name: 'Thorga (Fighter 5 Champion, hill dwarf)',
  definition: {
    baseAbilities: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 8 },
    speciesUid: SPECIES('hill-dwarf'),
    classes: [{ classUid: FIGHTER, subclassUid: SUB('champion'), level: 5, order: 0 }],
    choices: championChoices(5),
  },
  inventory: [item('mail', 'chain-mail'), item('shield', 'shield'), item('longsword', 'longsword')],
})
fixture('fighter-20-champion', {
  name: 'Thorga (Fighter 20 Champion, hill dwarf)',
  definition: {
    baseAbilities: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 8 },
    speciesUid: SPECIES('hill-dwarf'),
    classes: [{ classUid: FIGHTER, subclassUid: SUB('champion'), level: 20, order: 0 }],
    choices: championChoices(20),
  },
  inventory: [
    item('mail', 'plate-armor'),
    item('shield', 'shield'),
    item('longsword-1', 'longsword-1'),
    item('headband', 'headband-of-intellect', { attuned: true }),
  ],
})

const thiefChoices = (level) => ({
  [`class:${ROGUE}@1/skills`]: {
    kind: 'skill',
    skills: ['stealth', 'acrobatics', 'perception', 'deception'],
  },
  [`class:${ROGUE}@1/feature:rogue-expertise-1/expertise`]: {
    kind: 'expertise',
    skills: ['stealth', 'perception'],
  },
  'species:srd-5.1:species:high-elf/feature:high-elf-cantrip/cantrip': {
    kind: 'content',
    entries: [SPELL('fire-bolt')],
  },
  'species:srd-5.1:species:high-elf/feature:extra-language/language': {
    kind: 'language',
    languages: ['dwarvish'],
  },
  ...(level >= 4
    ? {
        [asiKey('rogue', 4, 'rogue-ability-score-improvement-1')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { dex: 2 },
        },
      }
    : {}),
  ...(level >= 6
    ? {
        [`class:${ROGUE}@6/feature:rogue-expertise-2/expertise`]: {
          kind: 'expertise',
          skills: ['acrobatics', 'deception'],
        },
      }
    : {}),
  ...(level >= 8
    ? {
        [asiKey('rogue', 8, 'rogue-ability-score-improvement-2')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { con: 2 },
        },
      }
    : {}),
  ...(level >= 10
    ? {
        [asiKey('rogue', 10, 'rogue-ability-score-improvement-3')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { cha: 2 },
        },
      }
    : {}),
  ...(level >= 12
    ? {
        [asiKey('rogue', 12, 'rogue-ability-score-improvement-4')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { wis: 2 },
        },
      }
    : {}),
  ...(level >= 16
    ? {
        [asiKey('rogue', 16, 'rogue-ability-score-improvement-5')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { int: 2 },
        },
      }
    : {}),
  ...(level >= 19
    ? {
        [asiKey('rogue', 19, 'rogue-ability-score-improvement-6')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { str: 2 },
        },
      }
    : {}),
})
fixture('rogue-5-thief', {
  name: 'Sable (Rogue 5 Thief, high elf)',
  definition: {
    baseAbilities: { str: 10, dex: 16, con: 12, int: 12, wis: 10, cha: 14 },
    speciesUid: SPECIES('high-elf'),
    classes: [{ classUid: ROGUE, subclassUid: SUB('thief'), level: 5, order: 0 }],
    choices: thiefChoices(5),
  },
  inventory: [item('leather', 'leather-armor'), item('rapier', 'rapier'), item('bow', 'shortbow')],
})
fixture('rogue-20-thief', {
  name: 'Sable (Rogue 20 Thief, high elf)',
  definition: {
    baseAbilities: { str: 10, dex: 16, con: 12, int: 12, wis: 10, cha: 14 },
    speciesUid: SPECIES('high-elf'),
    classes: [{ classUid: ROGUE, subclassUid: SUB('thief'), level: 20, order: 0 }],
    choices: thiefChoices(20),
  },
  inventory: [
    item('leather', 'studded-leather-armor'),
    item('rapier', 'rapier'),
    item('bow', 'shortbow'),
    item('gauntlets', 'gauntlets-of-ogre-power', { attuned: true }),
  ],
})

const lifeChoices = (level) => ({
  [`class:${CLERIC}@1/skills`]: { kind: 'skill', skills: ['medicine', 'religion'] },
  'species:srd-5.1:species:dwarf/feature:tool-proficiency/tool': {
    kind: 'tool',
    tools: ['smiths-tools'],
  },
  ...(level >= 4
    ? {
        [asiKey('cleric', 4, 'cleric-ability-score-improvement-1')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { wis: 2 },
        },
      }
    : {}),
  ...(level >= 8
    ? {
        [asiKey('cleric', 8, 'cleric-ability-score-improvement-2')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { wis: 2 },
        },
      }
    : {}),
  ...(level >= 12
    ? {
        [asiKey('cleric', 12, 'cleric-ability-score-improvement-3')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { con: 2 },
        },
      }
    : {}),
  ...(level >= 16
    ? {
        [asiKey('cleric', 16, 'cleric-ability-score-improvement-4')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { str: 2 },
        },
      }
    : {}),
  ...(level >= 19
    ? {
        [asiKey('cleric', 19, 'cleric-ability-score-improvement-5')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { con: 2 },
        },
      }
    : {}),
})
const clericSpells = (uids) =>
  uids.map((slug) => ({
    spellUid: SPELL(slug),
    origin: `class:${CLERIC}`,
    known: true,
    prepared: true,
    alwaysPrepared: false,
  }))
fixture('cleric-5-life', {
  name: 'Maren (Cleric 5 Life, hill dwarf)',
  definition: {
    baseAbilities: { str: 14, dex: 10, con: 14, int: 10, wis: 15, cha: 12 },
    speciesUid: SPECIES('hill-dwarf'),
    classes: [{ classUid: CLERIC, subclassUid: SUB('life'), level: 5, order: 0 }],
    choices: lifeChoices(5),
    spells: [
      ...clericSpells(['guiding-bolt', 'healing-word', 'spiritual-weapon', 'spirit-guardians']),
      {
        spellUid: SPELL('sacred-flame'),
        origin: `class:${CLERIC}`,
        known: true,
        prepared: false,
        alwaysPrepared: false,
      },
    ],
  },
  inventory: [item('mail', 'chain-mail'), item('shield', 'shield'), item('mace', 'mace')],
})
fixture('cleric-20-life', {
  name: 'Maren (Cleric 20 Life, hill dwarf)',
  definition: {
    baseAbilities: { str: 14, dex: 10, con: 14, int: 10, wis: 15, cha: 12 },
    speciesUid: SPECIES('hill-dwarf'),
    classes: [{ classUid: CLERIC, subclassUid: SUB('life'), level: 20, order: 0 }],
    choices: lifeChoices(20),
    spells: clericSpells([
      'guiding-bolt',
      'healing-word',
      'spiritual-weapon',
      'spirit-guardians',
      'heal',
      'mass-heal',
      'true-resurrection',
    ]),
  },
  inventory: [
    item('mail', 'plate-armor'),
    item('shield', 'shield'),
    item('mace', 'mace'),
    item('disruption', 'mace-of-disruption', { attuned: true }),
    item('wand', 'wand-of-magic-missiles', { chargesCurrent: 7 }),
  ],
})

const warlockChoices = (level, invocations, arcanum) => ({
  [`class:${WARLOCK}@1/skills`]: { kind: 'skill', skills: ['arcana', 'deception'] },
  [`class:${WARLOCK}@2/feature:eldritch-invocations/invocations`]: {
    kind: 'content',
    entries: invocations.map((slug) => F(`eldritch-invocation-${slug}`)),
  },
  [`class:${WARLOCK}@3/feature:pact-boon/pact-boon`]: {
    kind: 'optionSet',
    options: [level >= 20 ? 'blade' : 'tome'],
  },
  ...(level < 20
    ? {
        [`class:${WARLOCK}@3/feature:pact-boon/feature:pact-of-the-tome/cantrips`]: {
          kind: 'content',
          entries: [SPELL('fire-bolt'), SPELL('guidance'), SPELL('light')],
        },
      }
    : {}),
  ...(level >= 4
    ? {
        [asiKey('warlock', 4, 'warlock-ability-score-improvement-1')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { cha: 2 },
        },
      }
    : {}),
  ...(level >= 8
    ? {
        [asiKey('warlock', 8, 'warlock-ability-score-improvement-2')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { cha: 2 },
        },
      }
    : {}),
  ...(level >= 10
    ? {
        [`subclass:${SUB('fiend')}@10/feature:fiendish-resilience/resistance`]: {
          kind: 'optionSet',
          options: ['fire'],
        },
      }
    : {}),
  ...(level >= 12
    ? {
        [asiKey('warlock', 12, 'warlock-ability-score-improvement-3')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { con: 2 },
        },
      }
    : {}),
  ...(level >= 16
    ? {
        [asiKey('warlock', 16, 'warlock-ability-score-improvement-4')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { dex: 2 },
        },
      }
    : {}),
  ...(level >= 19
    ? {
        [asiKey('warlock', 19, 'warlock-ability-score-improvement-5')]: {
          kind: 'asiOrFeat',
          choice: 'asi',
          increases: { wis: 2 },
        },
      }
    : {}),
  ...(arcanum
    ? Object.fromEntries(
        Object.entries(arcanum).map(([lvl, slug]) => [
          `class:${WARLOCK}@${{ 6: 11, 7: 13, 8: 15, 9: 17 }[lvl]}/feature:mystic-arcanum-${lvl}th-level/arcanum`,
          { kind: 'content', entries: [SPELL(slug)] },
        ]),
      )
    : {}),
})
const warlockSpells = (uids) =>
  uids.map((slug) => ({
    spellUid: SPELL(slug),
    origin: `class:${WARLOCK}`,
    known: true,
    prepared: true,
    alwaysPrepared: false,
  }))
fixture('warlock-5-fiend', {
  name: 'Vey (Warlock 5 Fiend, human)',
  definition: {
    baseAbilities: { str: 8, dex: 14, con: 13, int: 10, wis: 11, cha: 15 },
    speciesUid: SPECIES('human'),
    classes: [{ classUid: WARLOCK, subclassUid: SUB('fiend'), level: 5, order: 0 }],
    choices: warlockChoices(5, ['agonizing-blast', 'devils-sight', 'armor-of-shadows']),
    spells: warlockSpells([
      'eldritch-blast',
      'burning-hands',
      'hellish-rebuke',
      'scorching-ray',
      'command',
      'fireball',
    ]),
  },
  inventory: [item('leather', 'leather-armor'), item('dagger', 'dagger')],
})
fixture('warlock-20-fiend', {
  name: 'Vey (Warlock 20 Fiend, human)',
  definition: {
    baseAbilities: { str: 8, dex: 14, con: 13, int: 10, wis: 11, cha: 15 },
    speciesUid: SPECIES('human'),
    classes: [{ classUid: WARLOCK, subclassUid: SUB('fiend'), level: 20, order: 0 }],
    choices: warlockChoices(
      20,
      [
        'agonizing-blast',
        'devils-sight',
        'armor-of-shadows',
        'beguiling-influence',
        'thirsting-blade',
        'lifedrinker',
        'eldritch-sight',
        'fiendish-vigor',
      ],
      { 6: 'circle-of-death', 7: 'finger-of-death', 8: 'dominate-monster', 9: 'foresight' },
    ),
    spells: warlockSpells([
      'eldritch-blast',
      'burning-hands',
      'hellish-rebuke',
      'scorching-ray',
      'command',
      'fireball',
      'wall-of-fire',
      'flame-strike',
    ]),
  },
  inventory: [
    item('leather', 'studded-leather-armor'),
    item('pact-sword', 'longsword'),
    item('ring', 'ring-of-protection', { attuned: true }),
  ],
})
fixture('fighter-5-warlock-3', {
  name: 'Two Oaths (Fighter 5 / Warlock 3)',
  definition: {
    baseAbilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 14 },
    speciesUid: SPECIES('human'),
    classes: [
      { classUid: FIGHTER, subclassUid: SUB('champion'), level: 5, order: 0 },
      { classUid: WARLOCK, subclassUid: SUB('fiend'), level: 3, order: 1 },
    ],
    choices: {
      [`class:${FIGHTER}@1/skills`]: { kind: 'skill', skills: ['athletics', 'intimidation'] },
      [`class:${FIGHTER}@1/feature:fighter-fighting-style/fighting-style`]: {
        kind: 'optionSet',
        options: ['great-weapon-fighting'],
      },
      [asiKey('fighter', 4, 'fighter-ability-score-improvement-1')]: {
        kind: 'asiOrFeat',
        choice: 'asi',
        increases: { str: 1, cha: 1 },
      },
      [`class:${WARLOCK}@2/feature:eldritch-invocations/invocations`]: {
        kind: 'content',
        entries: [F('eldritch-invocation-agonizing-blast'), F('eldritch-invocation-devils-sight')],
      },
      [`class:${WARLOCK}@3/feature:pact-boon/pact-boon`]: { kind: 'optionSet', options: ['blade'] },
    },
    spells: warlockSpells(['eldritch-blast', 'hellish-rebuke', 'burning-hands', 'scorching-ray']),
  },
  inventory: [item('mail', 'chain-mail'), item('greatsword', 'greatsword')],
})
fixture('rogue-3-cleric-2', {
  name: 'Quiet Prayer (Rogue 3 / Cleric 2)',
  definition: {
    baseAbilities: { str: 10, dex: 16, con: 12, int: 10, wis: 14, cha: 12 },
    speciesUid: SPECIES('hill-dwarf'),
    classes: [
      { classUid: ROGUE, subclassUid: SUB('thief'), level: 3, order: 0 },
      { classUid: CLERIC, subclassUid: SUB('life'), level: 2, order: 1 },
    ],
    choices: {
      [`class:${ROGUE}@1/skills`]: {
        kind: 'skill',
        skills: ['stealth', 'perception', 'insight', 'sleight-of-hand'],
      },
      [`class:${ROGUE}@1/feature:rogue-expertise-1/expertise`]: {
        kind: 'expertise',
        skills: ['stealth', 'perception'],
      },
      'species:srd-5.1:species:dwarf/feature:tool-proficiency/tool': {
        kind: 'tool',
        tools: ['masons-tools'],
      },
    },
    spells: clericSpells(['healing-word', 'guiding-bolt', 'bless']),
  },
  inventory: [item('leather', 'leather-armor'), item('rapier', 'rapier'), item('mace', 'mace')],
})
fixture('item-bench', {
  name: 'Item bench (Fighter 1, all weapon and armor proficiencies)',
  definition: {
    baseAbilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    classes: [{ classUid: FIGHTER, level: 1, order: 0 }],
    choices: {
      [`class:${FIGHTER}@1/skills`]: { kind: 'skill', skills: ['athletics', 'perception'] },
      [`class:${FIGHTER}@1/feature:fighter-fighting-style/fighting-style`]: {
        kind: 'optionSet',
        options: ['great-weapon-fighting'],
      },
    },
  },
  inventory: [],
})
console.log('fixtures written')
