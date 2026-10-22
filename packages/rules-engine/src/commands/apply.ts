import type { Ability } from '@scriptorium/content-schema'
import { applyPackets } from '../actions/apply.js'
import type { DamagePacket, TargetDefense } from '../actions/types.js'
import { entryOfKind } from '../snapshot.js'
import { evaluateStaticPredicate, type PredicateEnv } from '../static/predicates.js'
import type {
  CharacterAggregate,
  CharacterState,
  ComputedSheet,
  ContentSnapshot,
  InventoryItem,
  RulesetProfile,
} from '../types.js'
import {
  ATTUNEMENT_LIMIT,
  REVERSIBLE_COMMANDS,
  SNAPSHOT_COMMANDS,
  type CharacterCommand,
  type CommandErrorCode,
  type CommandEvent,
  type CommandResult,
  type Patch,
} from './types.js'

const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

function fail(code: CommandErrorCode, message: string): CommandResult {
  return { ok: false, code, message }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function numberStat(sheet: ComputedSheet, path: string): number {
  const v = sheet.stats[path]?.value
  return typeof v === 'number' ? v : 0
}

/**
 * Validates a command against the current sheet and returns the patch and the event the server
 * persists (docs/RULES_ENGINE.md §8). Pure: the aggregate passed in is never mutated.
 */
export function applyCommand(
  aggregate: CharacterAggregate,
  sheet: ComputedSheet,
  command: CharacterCommand,
  context: { snapshot?: ContentSnapshot; ruleset?: RulesetProfile } = {},
): CommandResult {
  const next = clone(aggregate)
  const touched = new Set<keyof Patch>()
  const state = () => {
    touched.add('state')
    return next.state
  }
  const definition = () => {
    touched.add('definition')
    return next.definition
  }
  const inventory = () => {
    touched.add('inventory')
    return next.inventory
  }
  const item = (id: string) => next.inventory.find((i) => i.id === id)
  const hpMax = sheet.hp.max
  let summary: string

  switch (command.type) {
    // ------------------------------------------------------------------------- inventory
    case 'addItem': {
      if (!command.itemUid && !command.customItem)
        return fail('INVALID', 'an item needs a content uid or a custom item')
      if (
        command.itemUid &&
        context.snapshot &&
        !entryOfKind(context.snapshot, command.itemUid, 'item')
      ) {
        return fail('NOT_FOUND', `unknown item ${command.itemUid}`)
      }
      const id =
        command.itemId ??
        `item-${next.inventory.length + 1}-${Math.abs(hash(JSON.stringify(command)))}`
      if (item(id)) return fail('INVALID', `item id ${id} already exists`)
      const row: InventoryItem = {
        id,
        quantity: command.quantity ?? 1,
        equipped: command.equipped ?? false,
        attuned: false,
        sortOrder: next.inventory.length,
      }
      if (command.itemUid) row.itemUid = command.itemUid
      if (command.customItem) row.customItem = command.customItem
      if (command.chargesCurrent !== undefined) row.chargesCurrent = command.chargesCurrent
      inventory().push(row)
      summary = `Added ${command.customItem?.name ?? command.itemUid}`
      break
    }
    case 'removeItem': {
      const row = item(command.itemId)
      if (!row) return fail('NOT_FOUND', 'item not found')
      inventory().splice(next.inventory.indexOf(row), 1)
      summary = `Removed ${row.itemUid ?? row.customItem?.name ?? row.id}`
      break
    }
    case 'equip':
    case 'unequip': {
      const row = item(command.itemId)
      if (!row) return fail('NOT_FOUND', 'item not found')
      const equipped = command.type === 'equip'
      if (row.equipped === equipped)
        return fail('INVALID', equipped ? 'already equipped' : 'not equipped')
      inventory()
      row.equipped = equipped
      if (!equipped) row.attuned = false
      summary = `${equipped ? 'Equipped' : 'Unequipped'} ${row.itemUid ?? row.id}`
      break
    }
    case 'attune':
    case 'unattune': {
      const row = item(command.itemId)
      if (!row) return fail('NOT_FOUND', 'item not found')
      const attuned = command.type === 'attune'
      if (row.attuned === attuned)
        return fail('INVALID', attuned ? 'already attuned' : 'not attuned')
      if (attuned) {
        const entry =
          row.customItem ??
          (row.itemUid && context.snapshot
            ? entryOfKind(context.snapshot, row.itemUid, 'item')
            : undefined)
        if (entry && !entry.data.requiresAttunement)
          return fail('INVALID', `${entry.name} does not require attunement`)
        const count = next.inventory.filter((i) => i.attuned).length
        if (count >= ATTUNEMENT_LIMIT)
          return fail('LIMIT', `you can attune to at most ${ATTUNEMENT_LIMIT} items`)
        if (!row.equipped) row.equipped = true
      }
      inventory()
      row.attuned = attuned
      summary = `${attuned ? 'Attuned to' : 'Ended attunement to'} ${row.itemUid ?? row.id}`
      break
    }
    case 'spendCharges':
    case 'recharge': {
      const row = item(command.itemId)
      if (!row) return fail('NOT_FOUND', 'item not found')
      const current = row.chargesCurrent ?? 0
      const amount = command.amount ?? 1
      if (amount < 0) return fail('INVALID', 'amount must be positive')
      if (command.type === 'spendCharges') {
        if (current < amount)
          return fail('INSUFFICIENT', `only ${current} charge${current === 1 ? '' : 's'} left`)
        inventory()
        row.chargesCurrent = current - amount
        summary = `Spent ${amount} charge${amount === 1 ? '' : 's'}`
      } else {
        const entry =
          row.customItem ??
          (row.itemUid && context.snapshot
            ? entryOfKind(context.snapshot, row.itemUid, 'item')
            : undefined)
        const max =
          typeof entry?.data.charges?.max === 'number' ? entry.data.charges.max : undefined
        inventory()
        row.chargesCurrent =
          command.amount === undefined && max !== undefined
            ? max
            : Math.min(current + amount, max ?? Number.MAX_SAFE_INTEGER)
        summary = `Recharged to ${row.chargesCurrent}`
      }
      break
    }

    // ------------------------------------------------------------------------- runtime state
    case 'applyDamage': {
      if (command.amount < 0) return fail('INVALID', 'damage cannot be negative')
      const s = state()
      const defenses: TargetDefense[] = sheet.defenses.map((d) => ({
        kind: d.kind,
        damageType: d.damageType,
        ...(d.condition ? { condition: d.condition } : {}),
      }))
      const packet: DamagePacket = {
        id: 'damage',
        label: 'Damage',
        amount: Math.floor(command.amount),
        damageType: command.damageType ?? 'untyped',
        flags: {
          magical: command.magical ?? false,
          silvered: false,
          adamantine: false,
          fromSpell: false,
          weapon: false,
        },
      }
      const result = applyPackets(
        command.damageType ? defenses : [],
        { hpCurrent: s.hpCurrent, hpTemp: s.hpTemp },
        [packet],
        (leaf) => staticLeaf(leaf, sheet),
      )
      s.hpCurrent = result.state.hpCurrent
      s.hpTemp = result.state.hpTemp
      const taken = result.packets[0]?.taken ?? 0
      summary = `Took ${taken} ${command.damageType ?? ''} damage`.replace('  ', ' ')
      break
    }
    case 'heal': {
      if (command.amount < 0) return fail('INVALID', 'healing cannot be negative')
      const s = state()
      s.hpCurrent = Math.min(hpMax, s.hpCurrent + Math.floor(command.amount))
      summary = `Healed ${Math.floor(command.amount)}`
      break
    }
    case 'setTempHp': {
      if (command.amount < 0) return fail('INVALID', 'temporary hit points cannot be negative')
      state().hpTemp = Math.floor(command.amount)
      summary = `Temporary hit points set to ${Math.floor(command.amount)}`
      break
    }
    case 'spendSlot':
    case 'restoreSlot': {
      const casting = sheet.spellcasting
      const slot = casting?.slots.find((x) => x.level === command.level)
      if (!slot) return fail('NOT_FOUND', `no level ${command.level} spell slots`)
      const key = String(command.level)
      const used = next.state.spellSlotsUsed[key] ?? 0
      if (command.type === 'spendSlot') {
        if (used >= slot.max) return fail('INSUFFICIENT', `no level ${command.level} slots left`)
        state().spellSlotsUsed[key] = used + 1
        summary = `Spent a level ${command.level} spell slot`
      } else {
        if (used <= 0) return fail('INVALID', `no level ${command.level} slots are spent`)
        state().spellSlotsUsed[key] = used - 1
        summary = `Restored a level ${command.level} spell slot`
      }
      break
    }
    case 'spendPactSlot':
    case 'restorePactSlot': {
      const pact = sheet.spellcasting?.pact
      if (!pact || pact.slots === 0) return fail('NOT_FOUND', 'no pact magic slots')
      if (command.type === 'spendPactSlot') {
        if (next.state.pactSlotsUsed >= pact.slots)
          return fail('INSUFFICIENT', 'no pact slots left')
        state().pactSlotsUsed += 1
        summary = 'Spent a pact magic slot'
      } else {
        if (next.state.pactSlotsUsed <= 0) return fail('INVALID', 'no pact slots are spent')
        state().pactSlotsUsed -= 1
        summary = 'Restored a pact magic slot'
      }
      break
    }
    case 'useResource':
    case 'restoreResource': {
      const resource = sheet.resources.find((r) => r.id === command.id)
      if (!resource) return fail('NOT_FOUND', `no resource ${command.id}`)
      const max = typeof resource.max.value === 'number' ? resource.max.value : 0
      const current = next.state.resources[command.id] ?? max
      const amount = command.amount ?? (command.type === 'useResource' ? 1 : max - current)
      if (command.type === 'useResource') {
        if (current < amount) return fail('INSUFFICIENT', `${resource.name}: ${current} left`)
        state().resources[command.id] = current - amount
        summary = `Used ${resource.name}`
      } else {
        state().resources[command.id] = Math.min(max, current + amount)
        summary = `Restored ${resource.name}`
      }
      break
    }
    case 'applyCondition': {
      const s = state()
      const existing = s.conditions.find((c) => c.uid === command.uid)
      if (existing) {
        if (command.level === undefined || existing.level === command.level)
          return fail('INVALID', 'condition already applied')
        existing.level = command.level
      } else {
        s.conditions.push({
          uid: command.uid,
          ...(command.level !== undefined ? { level: command.level } : {}),
        })
      }
      summary = `Applied ${command.uid.split(':').pop()}`
      break
    }
    case 'removeCondition': {
      const s = state()
      const index = s.conditions.findIndex((c) => c.uid === command.uid)
      if (index < 0) return fail('NOT_FOUND', 'condition not present')
      s.conditions.splice(index, 1)
      summary = `Removed ${command.uid.split(':').pop()}`
      break
    }
    case 'setExhaustion': {
      if (command.level < 0 || command.level > 6 || !Number.isInteger(command.level))
        return fail('INVALID', 'exhaustion is 0 to 6')
      state().exhaustion = command.level
      summary = `Exhaustion ${command.level}`
      break
    }
    case 'toggle': {
      if (!sheet.toggles.some((t) => t.id === command.id))
        return fail('NOT_FOUND', `no toggle ${command.id}`)
      state().toggles[command.id] = command.active
      summary = `${command.active ? 'Activated' : 'Deactivated'} ${command.id}`
      break
    }
    case 'adjustCurrency': {
      const s = state()
      for (const coin of ['cp', 'sp', 'ep', 'gp', 'pp'] as const) {
        const delta = command.delta[coin] ?? 0
        if (!Number.isInteger(delta)) return fail('INVALID', 'coins are whole numbers')
        if (s.currency[coin] + delta < 0) return fail('INSUFFICIENT', `not enough ${coin}`)
        s.currency[coin] += delta
      }
      summary = 'Adjusted currency'
      break
    }
    case 'setInspiration':
      state().inspiration = command.value
      summary = command.value ? 'Gained inspiration' : 'Spent inspiration'
      break
    case 'shortRest': {
      const s = state()
      let healed = 0
      for (const spent of command.hitDice ?? []) {
        const pool = sheet.hitDice.find((h) => h.die === spent.die)
        if (!pool) return fail('NOT_FOUND', `no ${spent.die} hit dice`)
        const used = s.hitDiceSpent[spent.die] ?? 0
        if (used >= pool.max) return fail('INSUFFICIENT', `no ${spent.die} hit dice left`)
        const faces = Number(spent.die.slice(1))
        if (!Number.isInteger(spent.roll) || spent.roll < 1 || spent.roll > faces)
          return fail('INVALID', `a ${spent.die} cannot show ${spent.roll}`)
        s.hitDiceSpent[spent.die] = used + 1
        healed += Math.max(0, spent.roll + numberStat(sheet, 'ability.con.mod'))
      }
      s.hpCurrent = Math.min(hpMax, s.hpCurrent + healed)
      for (const resource of sheet.resources)
        if (resource.recharge === 'shortRest') delete s.resources[resource.id]
      if (sheet.spellcasting?.pact) s.pactSlotsUsed = 0
      summary = `Short rest${healed ? ` (+${healed} HP)` : ''}`
      break
    }
    case 'longRest': {
      const s = state()
      s.hpCurrent = hpMax
      s.hpTemp = 0
      s.spellSlotsUsed = {}
      s.pactSlotsUsed = 0
      for (const resource of sheet.resources) {
        if (
          resource.recharge === 'shortRest' ||
          resource.recharge === 'longRest' ||
          resource.recharge === 'dawn'
        )
          delete s.resources[resource.id]
      }
      // Regain half the total hit dice (minimum 1), largest dice first (2014).
      let regain = Math.max(1, Math.floor(sheet.hitDice.reduce((n, h) => n + h.max, 0) / 2))
      for (const pool of [...sheet.hitDice].sort(
        (a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)),
      )) {
        const spent = s.hitDiceSpent[pool.die] ?? 0
        const back = Math.min(spent, regain)
        if (back > 0) {
          s.hitDiceSpent[pool.die] = spent - back
          regain -= back
        }
      }
      s.exhaustion = Math.max(0, s.exhaustion - 1)
      s.deathSaves = { successes: 0, failures: 0 }
      summary = 'Long rest'
      break
    }
    case 'turnStarted': {
      const s = state()
      s.combat.turn = {
        encounterId: command.encounterId ?? null,
        round: command.round ?? null,
        turnId: command.turnId,
        ownTurn: command.ownTurn,
      }
      if (command.ownTurn) {
        s.combat.reaction.usedOnTurnId = null
        s.combat.bonusAction.usedOnTurnId = null
        s.combat.actions.usedOnTurnId = null
        s.combat.actions.budget = 1
      }
      summary = command.ownTurn ? 'Your turn' : 'Another turn begins'
      break
    }
    case 'applyActionOutcome': {
      const s = state()
      const outcome = command.outcome
      for (const cost of outcome.costs) {
        if (!cost.sufficient) return fail('INSUFFICIENT', `cannot pay ${cost.kind}`)
        switch (cost.kind) {
          case 'resource': {
            const current = s.resources[cost.id!] ?? cost.available
            if (current < cost.amount) return fail('INSUFFICIENT', `${cost.id}: ${current} left`)
            s.resources[cost.id!] = current - cost.amount
            break
          }
          case 'slot': {
            const key = String(cost.level)
            s.spellSlotsUsed[key] = (s.spellSlotsUsed[key] ?? 0) + cost.amount
            break
          }
          case 'pact':
            s.pactSlotsUsed += cost.amount
            break
          case 'charges': {
            const row = cost.id ? item(cost.id) : undefined
            if (!row) return fail('NOT_FOUND', 'charged item not found')
            if ((row.chargesCurrent ?? 0) < cost.amount)
              return fail('INSUFFICIENT', 'not enough charges')
            inventory()
            row.chargesCurrent = (row.chargesCurrent ?? 0) - cost.amount
            break
          }
        }
      }
      for (const key of outcome.oncePerTurnMarks) s.combat.oncePerTurn[key] = s.combat.turn.turnId
      if (outcome.economyMark === 'action') s.combat.actions.usedOnTurnId = s.combat.turn.turnId
      if (outcome.economyMark === 'bonus') s.combat.bonusAction.usedOnTurnId = s.combat.turn.turnId
      if (outcome.economyMark === 'reaction') s.combat.reaction.usedOnTurnId = s.combat.turn.turnId
      if (outcome.concentration && outcome.ref.kind === 'spell')
        s.concentration = { spellUid: outcome.ref.spellUid, startedTurnId: s.combat.turn.turnId }
      summary = `${outcome.name}${outcome.attack ? (outcome.attack.hit === false ? ' (miss)' : outcome.attack.critical ? ' (critical hit)' : outcome.attack.hit ? ' (hit)' : '') : ''}`
      break
    }

    // ------------------------------------------------------------------------- definition
    case 'setName': {
      const name = command.name.trim()
      if (name.length === 0 || name.length > 80)
        return fail('INVALID', 'a name has 1 to 80 characters')
      touched.add('name')
      next.name = name
      summary = `Renamed to ${name}`
      break
    }
    case 'setAbilities': {
      for (const ability of ABILITIES) {
        const v = command.abilities[ability]
        if (!Number.isInteger(v) || v < 1 || v > 30)
          return fail('INVALID', `${ability} must be 1 to 30`)
      }
      if (command.method === 'standard') {
        const array = context.ruleset?.config.standardArray ?? [15, 14, 13, 12, 10, 8]
        const sorted = ABILITIES.map((a) => command.abilities[a]).sort((a, b) => b - a)
        if (JSON.stringify(sorted) !== JSON.stringify([...array].sort((a, b) => b - a)))
          return fail('INVALID', 'the standard array must be used exactly once')
      }
      if (command.method === 'point_buy' && context.ruleset) {
        const pb = context.ruleset.config.pointBuy
        let spent = 0
        for (const ability of ABILITIES) {
          const v = command.abilities[ability]
          if (v < pb.min || v > pb.max)
            return fail('INVALID', `point buy scores are ${pb.min} to ${pb.max}`)
          spent += pb.costs[String(v)] ?? 0
        }
        if (spent > pb.budget)
          return fail('INVALID', `point buy spends ${spent} of ${pb.budget} points`)
      }
      const d = definition()
      d.abilityMethod = command.method
      d.baseAbilities = { ...command.abilities }
      summary = 'Set ability scores'
      break
    }
    case 'setSpecies': {
      if (command.uid && context.snapshot && !entryOfKind(context.snapshot, command.uid, 'species'))
        return fail('NOT_FOUND', `unknown species ${command.uid}`)
      const d = definition()
      if (command.uid) d.speciesUid = command.uid
      else delete d.speciesUid
      summary = command.uid ? `Species: ${command.uid.split(':').pop()}` : 'Cleared species'
      break
    }
    case 'setBackground': {
      if (
        command.uid &&
        context.snapshot &&
        !entryOfKind(context.snapshot, command.uid, 'background')
      )
        return fail('NOT_FOUND', `unknown background ${command.uid}`)
      const d = definition()
      if (command.uid) d.backgroundUid = command.uid
      else delete d.backgroundUid
      summary = command.uid ? `Background: ${command.uid.split(':').pop()}` : 'Cleared background'
      break
    }
    case 'addClassLevel': {
      const d = definition()
      const total = d.classes.reduce((n, c) => n + c.level, 0)
      const maxLevel = context.ruleset?.config.maxLevel ?? 20
      if (total >= maxLevel) return fail('LIMIT', `level ${maxLevel} is the maximum`)
      const classEntry = context.snapshot
        ? entryOfKind(context.snapshot, command.classUid, 'class')
        : undefined
      if (context.snapshot && !classEntry)
        return fail('NOT_FOUND', `unknown class ${command.classUid}`)
      const existing = d.classes.find((c) => c.classUid === command.classUid)
      if (!existing && d.classes.length > 0 && classEntry) {
        // 2014 multiclassing: meet the new class's prerequisite and every current class's.
        const unmet: string[] = []
        const checks = [
          classEntry,
          ...d.classes.map((c) => entryOfKind(context.snapshot!, c.classUid, 'class')),
        ]
        for (const entry of checks) {
          const prerequisite = entry?.data.multiclassing?.prerequisite
          if (!prerequisite) continue
          if (
            !evaluateStaticPredicate(prerequisite, predicateEnv(sheet), {
              kind: 'class',
              name: entry.name,
              path: `class:${entry.uid}`,
              order: 0,
            })
          ) {
            unmet.push(entry.data.multiclassing?.prerequisiteText ?? `${entry.name} prerequisite`)
          }
        }
        if (unmet.length > 0)
          return fail('PREREQ_UNMET', `multiclass prerequisites not met: ${unmet.join('; ')}`)
      }
      if (command.hitDieRoll !== undefined) {
        const faces = classEntry ? Number(classEntry.data.hitDie.slice(1)) : 12
        if (
          !Number.isInteger(command.hitDieRoll) ||
          command.hitDieRoll < 1 ||
          command.hitDieRoll > faces
        )
          return fail('INVALID', `hit die roll must be 1 to ${faces}`)
      }
      if (existing) {
        existing.level += 1
        if (command.hitDieRoll !== undefined)
          existing.hitDiceRolls = [...(existing.hitDiceRolls ?? []), command.hitDieRoll]
        if (command.subclassUid && !existing.subclassUid) existing.subclassUid = command.subclassUid
      } else {
        d.classes.push({
          classUid: command.classUid,
          level: 1,
          order: d.classes.length,
          ...(command.subclassUid ? { subclassUid: command.subclassUid } : {}),
          ...(command.hitDieRoll !== undefined ? { hitDiceRolls: [command.hitDieRoll] } : {}),
        })
      }
      summary = `Level ${total + 1}: ${classEntry?.name ?? command.classUid}`
      break
    }
    case 'removeClassLevel': {
      const d = definition()
      const existing = d.classes.find((c) => c.classUid === command.classUid)
      if (!existing) return fail('NOT_FOUND', 'no levels in that class')
      if (existing.level > 1) {
        existing.level -= 1
        if (existing.hitDiceRolls)
          existing.hitDiceRolls = existing.hitDiceRolls.slice(0, existing.level)
      } else {
        d.classes.splice(d.classes.indexOf(existing), 1)
        d.classes.forEach((c, i) => (c.order = i))
      }
      summary = `Removed a level of ${command.classUid.split(':').pop()}`
      break
    }
    case 'setSubclass': {
      const d = definition()
      const existing = d.classes.find((c) => c.classUid === command.classUid)
      if (!existing) return fail('NOT_FOUND', 'no levels in that class')
      if (command.subclassUid) {
        const sub = context.snapshot
          ? entryOfKind(context.snapshot, command.subclassUid, 'subclass')
          : undefined
        if (context.snapshot && !sub)
          return fail('NOT_FOUND', `unknown subclass ${command.subclassUid}`)
        if (sub && sub.data.class !== command.classUid)
          return fail('INVALID', `${sub.name} belongs to ${sub.data.class}`)
        const classEntry = context.snapshot
          ? entryOfKind(context.snapshot, command.classUid, 'class')
          : undefined
        if (classEntry && existing.level < classEntry.data.subclassLevel)
          return fail(
            'PREREQ_UNMET',
            `${classEntry.name} chooses a ${classEntry.data.subclassTitle} at level ${classEntry.data.subclassLevel}`,
          )
        existing.subclassUid = command.subclassUid
      } else delete existing.subclassUid
      summary = command.subclassUid
        ? `Subclass: ${command.subclassUid.split(':').pop()}`
        : 'Cleared subclass'
      break
    }
    case 'setChoice': {
      definition().choices[command.key] = command.selection
      summary = `Chose ${command.key.split('/').pop()}`
      break
    }
    case 'clearChoice': {
      if (!(command.key in next.definition.choices)) return fail('NOT_FOUND', 'no such choice')
      delete definition().choices[command.key]
      summary = `Cleared ${command.key.split('/').pop()}`
      break
    }
    case 'setSpells': {
      if (context.snapshot) {
        for (const spell of command.spells) {
          if (!entryOfKind(context.snapshot, spell.spellUid, 'spell'))
            return fail('NOT_FOUND', `unknown spell ${spell.spellUid}`)
        }
      }
      definition().spells = command.spells.map((s) => ({ ...s }))
      summary = `Spells updated (${command.spells.length})`
      break
    }
    case 'setHpMode': {
      definition().hpMode = command.mode
      summary = `Hit points: ${command.mode}`
      break
    }
    case 'setOverride': {
      const d = definition()
      const existing = d.overrides.find((o) => o.statPath === command.statPath)
      if (existing) {
        existing.value = command.value
        if (command.note !== undefined) existing.note = command.note
      } else
        d.overrides.push({
          statPath: command.statPath,
          value: command.value,
          ...(command.note ? { note: command.note } : {}),
        })
      summary = `Override ${command.statPath} = ${String(command.value)}`
      break
    }
    case 'clearOverride': {
      const d = definition()
      const index = d.overrides.findIndex((o) => o.statPath === command.statPath)
      if (index < 0) return fail('NOT_FOUND', 'no override on that stat')
      d.overrides.splice(index, 1)
      summary = `Cleared override on ${command.statPath}`
      break
    }
    case 'setAssumption': {
      const s = state()
      if (command.value === undefined || command.value === null) delete s.assumptions[command.id]
      else s.assumptions[command.id] = command.value
      summary = `Assumption ${command.id}`
      break
    }

    // ------------------------------------------------------------------------- compensation and restore
    case 'undo': {
      if (command.before.name !== undefined) {
        touched.add('name')
        next.name = command.before.name
      }
      if (command.before.definition) {
        touched.add('definition')
        next.definition = clone(command.before.definition)
      }
      if (command.before.inventory) {
        touched.add('inventory')
        next.inventory = clone(command.before.inventory)
      }
      if (command.before.state) {
        touched.add('state')
        next.state = clone(command.before.state)
      }
      summary = `Undid ${command.eventType}`
      break
    }
    case 'restoreSnapshot': {
      touched.add('name')
      touched.add('definition')
      touched.add('inventory')
      touched.add('state')
      next.name = command.aggregate.name
      next.definition = clone(command.aggregate.definition)
      next.inventory = clone(command.aggregate.inventory)
      next.state = clone(command.aggregate.state)
      summary = 'Restored a snapshot'
      break
    }
    default:
      return fail('UNSUPPORTED', `unknown command ${(command as { type: string }).type}`)
  }

  const patch: Patch = {}
  const before: Patch = {}
  const after: Patch = {}
  for (const section of touched) {
    switch (section) {
      case 'name':
        before.name = aggregate.name
        after.name = next.name
        patch.name = next.name
        break
      case 'definition':
        before.definition = clone(aggregate.definition)
        after.definition = clone(next.definition)
        patch.definition = next.definition
        break
      case 'inventory':
        before.inventory = clone(aggregate.inventory)
        after.inventory = clone(next.inventory)
        patch.inventory = next.inventory
        break
      case 'state':
        before.state = clone(aggregate.state)
        after.state = clone(next.state)
        patch.state = next.state
        break
    }
  }
  const reversible = REVERSIBLE_COMMANDS.has(command.type)
  const snapshotReason = SNAPSHOT_COMMANDS[command.type]
  const event: CommandEvent = {
    type: command.type,
    payload: command,
    before,
    after,
    reversible,
    summary,
    ...(snapshotReason ? { snapshotReason } : {}),
  }
  return { ok: true, patch, event, aggregate: next }
}

function predicateEnv(sheet: ComputedSheet): PredicateEnv {
  return {
    facts: {
      level: sheet.level,
      classLevels: new Map(Object.entries(sheet.facts.classLevels)),
      speciesChain: new Set(sheet.facts.speciesChain),
      subclasses: new Set(sheet.facts.subclasses),
      features: new Set(sheet.facts.features),
      conditions: new Set(sheet.facts.conditions),
      activeToggles: new Set(sheet.facts.activeToggles),
      armorCategory: sheet.facts.armorCategory,
      shield: sheet.facts.shield,
      equippedItems: new Set(sheet.facts.equippedItems),
      attunedItems: new Set(sheet.facts.attunedItems),
    },
    lookup: {
      number: (path) => numberStat(sheet, path),
      boolean: (path) => Boolean(sheet.stats[path]?.value),
      value: (path) => sheet.stats[path]?.value ?? 0,
    },
    diagnostic: () => undefined,
  }
}

function staticLeaf(leaf: { leaf: string }, sheet: ComputedSheet): boolean {
  const l = leaf as { leaf: string; id?: string; condition?: string; feature?: string }
  switch (l.leaf) {
    case 'toggle':
      return sheet.facts.activeToggles.includes(l.id ?? '')
    case 'hasCondition':
      return sheet.facts.conditions.includes(l.condition ?? '')
    case 'hasFeature':
      return sheet.facts.features.includes(l.feature ?? '')
    default:
      return false
  }
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export type { CharacterState }
