/**
 * Encounters (M2.8 thin slice): party and monsters, initiative, rounds and turns issuing
 * `turnStarted`, and the action coordinator of docs/ARCHITECTURE.md §6: one transaction that
 * locks the encounter and the involved characters in a fixed order, consumes the roll once,
 * applies the attacker's outcome and the target's packets, logs both sides and writes a receipt.
 */
import { TRPCError } from '@trpc/server'
import { and, eq, isNull } from 'drizzle-orm'
import type { ContentEntryOf } from '@scriptorium/content-schema'
import {
  createCryptoRng,
  dieRoller,
  roll as rollExpression,
  rollD20,
  type DieRoller,
  type RollMode,
} from '@scriptorium/dice/roll'
import {
  applyPackets,
  applyRolls,
  defensesFromSheet,
  monsterDefenses,
  planAction,
  type ActionContext,
  type ActionPlan,
  type ActionRef,
  type DamagePacket,
  type TargetDefense,
} from '@scriptorium/rules-engine'
import { schema, type Db } from '../../db/client.js'
import { CommandError, type CommandRunner, type Tx } from '../../core/commands.js'
import type { DomainEvent, EventBus } from '../../core/events.js'
import { newId } from '../../core/ids.js'
import type { Scope } from '../../core/policy.js'
import type { CampaignService } from '../campaigns/service.js'
import type { CharacterRepo } from '../characters/repo.js'
import { rollForPlan, type RollResults } from '../characters/rolls.js'
import { characterRootUids, loadSnapshot } from '../characters/snapshot.js'
import type { ContentRepo } from '../content/repo.js'
import type { EncounterRepo, ParticipantRow } from './repo.js'

type MonsterEntry = ContentEntryOf<'monster'>
type MonsterAction = MonsterEntry['data']['actions'][number]

export type AttackAction =
  | { kind: 'weapon'; itemId: string }
  | { kind: 'unarmed' }
  | { kind: 'action'; templateId: string }
  | { kind: 'monster'; index: number }

/** A monster's stat-block attack, resolved the same way as a character plan but without the engine. */
export type MonsterPlan = {
  kind: 'monster'
  name: string
  attackBonus: number
  mode: RollMode
  damage: Array<{ id: string; formula: string; damageType: string }>
  targetAc: number | null
}

export type CharacterPlan = { kind: 'character'; plan: ActionPlan; targetAc: number | null }
export type AttackPlan = CharacterPlan | MonsterPlan

type StoredAttack = {
  kind: 'encounterAttack'
  encounterId: string
  attackerId: string
  targetId: string
  plan: AttackPlan
  results: RollResults & {
    monster?: {
      natural: number
      total: number
      critical: boolean
      damage: Record<string, number>
      details: Record<string, string>
    }
  }
}

const SUMMARY_LIMIT = 40

function turnIdOf(encounterId: string, round: number, turnIndex: number): string {
  return `${encounterId}:${round}:${turnIndex}`
}

function abilityMod(score: number | undefined): number {
  return Math.floor(((score ?? 10) - 10) / 2)
}

function monsterAc(data: MonsterEntry['data']): number | null {
  const first = data.armorClass[0]
  return first ? first.value : null
}

export function createEncounterService(deps: {
  db: Db
  repo: EncounterRepo
  campaigns: CampaignService
  characters: CharacterRepo
  content: ContentRepo
  commands: CommandRunner
  events: EventBus
  dice?: DieRoller
}) {
  const { repo } = deps
  const dice = deps.dice ?? dieRoller(createCryptoRng())

  async function load(scope: Scope, encounterId: string) {
    const encounter = await repo.get(deps.db, encounterId)
    if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found.' })
    const role = await deps.campaigns.roleOf(scope, encounter.campaignId)
    return { encounter, role }
  }

  async function loadForDm(scope: Scope, encounterId: string) {
    const loaded = await load(scope, encounterId)
    if (loaded.role !== 'dm')
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the DM runs the encounter.' })
    return loaded
  }

  /** A completed encounter is a read-only record (issue #27): every mutation stops here. */
  function assertEditable(encounter: { status: string }): void {
    if (encounter.status === 'completed')
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'This encounter has ended and cannot be edited.',
      })
  }

  /** The DM's load for a mutation: role check plus the read-only guard. */
  async function loadForEdit(scope: Scope, encounterId: string) {
    const loaded = await loadForDm(scope, encounterId)
    assertEditable(loaded.encounter)
    return loaded
  }

  async function monsterEntry(uid: string, versionId: string | null): Promise<MonsterEntry> {
    const { snapshot } = await loadSnapshot(
      deps.db,
      [uid],
      versionId ? new Map([[uid, versionId]]) : new Map(),
    )
    const entry = snapshot.get(uid)
    if (!entry || entry.kind !== 'monster')
      throw new TRPCError({ code: 'NOT_FOUND', message: `Monster ${uid} is not installed.` })
    return entry
  }

  async function characterView(characterId: string) {
    const view = await deps.commands.view(characterId)
    if (!view) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
    return view
  }

  function orderOf(participants: ParticipantRow[]): ParticipantRow[] {
    return [...participants].sort(
      (a, b) =>
        (b.initiative ?? -999) - (a.initiative ?? -999) ||
        b.tiebreak - a.tiebreak ||
        a.displayName.localeCompare(b.displayName),
    )
  }

  /** Issues `turnStarted` to every participant inside `tx`; returns the events to emit after commit. */
  async function startTurn(
    tx: Tx,
    scope: Scope,
    encounterId: string,
    participants: ParticipantRow[],
    round: number,
    turnIndex: number,
  ): Promise<{ turnId: string; emits: DomainEvent[] }> {
    const turnId = turnIdOf(encounterId, round, turnIndex)
    const order = orderOf(participants)
    const current = order[turnIndex]
    const emits: DomainEvent[] = []
    for (const p of participants) {
      const ownTurn = p.id === current?.id
      if (p.kind === 'character' && p.characterId) {
        const row = await deps.characters.getRow(tx, p.characterId, { forUpdate: true })
        if (!row) continue
        const request = {
          commandId: newId(),
          characterId: p.characterId,
          expectedRevision: row.revision,
          command: { type: 'turnStarted' as const, turnId, ownTurn, encounterId, round },
          actorUserId: scope.userId ?? null,
        }
        const applied = await deps.commands.applyInTx(tx, request, { actionId: undefined })
        emits.push(deps.commands.changedEvent(request, applied.outcome))
      } else {
        await repo.updateParticipant(tx, p.id, { combat: { turn: { turnId, ownTurn, round } } })
      }
    }
    return { turnId, emits }
  }

  async function targetContext(target: ParticipantRow): Promise<{
    ctx: ActionContext['target']
    ac: number | null
    defenses: TargetDefense[]
  }> {
    if (target.kind === 'monster' && target.entryUid) {
      const entry = await monsterEntry(target.entryUid, target.versionId)
      const defenses = monsterDefenses(entry.data).defenses
      const ac = target.ac ?? monsterAc(entry.data)
      return {
        ctx: {
          name: target.displayName,
          creatureType: entry.data.type,
          size: entry.data.size,
          conditions: (target.conditions as Array<{ uid: string }>).map((c) =>
            c.uid.split(':').pop()!,
          ),
          ...(ac !== null ? { ac } : {}),
          defenses,
        },
        ac,
        defenses,
      }
    }
    const view = await characterView(target.characterId!)
    const acValue = view.sheet.stats['ac.total']?.value
    const ac = typeof acValue === 'number' ? acValue : null
    const defenses = defensesFromSheet(view.sheet.defenses)
    return {
      ctx: {
        name: target.displayName,
        creatureType: 'humanoid',
        conditions: view.sheet.facts.conditions,
        ...(ac !== null ? { ac } : {}),
        defenses,
      },
      ac,
      defenses,
    }
  }

  async function buildPlan(
    encounterId: string,
    attackerId: string,
    targetId: string,
    action: AttackAction,
    mode: RollMode,
  ): Promise<{ plan: AttackPlan; attacker: ParticipantRow; target: ParticipantRow }> {
    const participants = await repo.participants(deps.db, encounterId)
    const attacker = participants.find((p) => p.id === attackerId)
    const target = participants.find((p) => p.id === targetId)
    if (!attacker || !target)
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Attacker or target is not in this encounter.',
      })
    const { ctx, ac } = await targetContext(target)
    if (action.kind === 'monster') {
      if (attacker.kind !== 'monster' || !attacker.entryUid)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That participant is not a monster.' })
      const entry = await monsterEntry(attacker.entryUid, attacker.versionId)
      const stat: MonsterAction | undefined = entry.data.actions[action.index]
      if (!stat || !stat.attack)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That action is not an attack.' })
      return {
        plan: {
          kind: 'monster',
          name: `${attacker.displayName}: ${stat.name}`,
          attackBonus: stat.attack.toHit,
          mode,
          damage: (stat.damage ?? []).map((d, i) => ({
            id: `damage-${i}`,
            formula: d.dice,
            damageType: d.damageType ?? 'untyped',
          })),
          targetAc: ac,
        },
        attacker,
        target,
      }
    }
    if (attacker.kind !== 'character' || !attacker.characterId)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'That participant is not a character.' })
    const view = await characterView(attacker.characterId)
    const pinned = await deps.characters.getPinnedRefs(deps.db, attacker.characterId)
    const { snapshot } = await loadSnapshot(deps.db, characterRootUids(view.aggregate), pinned)
    const ref: ActionRef =
      action.kind === 'weapon'
        ? { kind: 'weapon', itemId: action.itemId }
        : action.kind === 'unarmed'
          ? { kind: 'unarmed' }
          : { kind: 'action', templateId: action.templateId }
    const situation =
      mode === 'advantage'
        ? { advantageSources: ['DM'] }
        : mode === 'disadvantage'
          ? { disadvantageSources: ['DM'] }
          : {}
    const plan = planAction(view.sheet, view.aggregate, ref, { target: ctx, situation }, snapshot)
    return { plan: { kind: 'character', plan, targetAc: ac }, attacker, target }
  }

  /** Fields in event payloads that reveal monster hit points; players never receive them (D-3). */
  const DM_ONLY_PAYLOAD_FIELDS = ['targetHp', 'hpCurrent', 'hpMax', 'hpTemp'] as const

  function serializeEvent<T extends { payload: unknown }>(
    e: T,
    role: 'dm' | 'player',
  ): Omit<T, 'payload'> & { payload: Record<string, unknown> } {
    const payload = { ...(e.payload as Record<string, unknown>) }
    if (role === 'player') for (const key of DM_ONLY_PAYLOAD_FIELDS) delete payload[key]
    return { ...e, payload }
  }

  /**
   * A character participant has one source of truth, the character aggregate (issue #13): its
   * conditions are read from there, never from the participant row, which holds conditions for
   * monsters only. `canOpenSheet` is computed here so the client never advertises a sheet the
   * viewer cannot open (issue #19); the character service still enforces it on read.
   */
  type CharacterFacts = {
    view: Awaited<ReturnType<typeof characterView>>
    conditions: Array<{ uid: string }>
    canOpenSheet: boolean
  }

  function serializeParticipant(
    p: ParticipantRow,
    role: 'dm' | 'player',
    character: CharacterFacts | undefined,
  ) {
    const hidden = role === 'player' && p.kind === 'monster'
    return {
      id: p.id,
      kind: p.kind as 'monster' | 'character',
      characterId: p.characterId,
      entryUid: p.entryUid,
      displayName: p.displayName,
      initiative: p.initiative,
      hpCurrent: hidden ? null : p.hpCurrent,
      hpMax: hidden ? null : p.hpMax,
      hpTemp: hidden ? 0 : p.hpTemp,
      ac: hidden ? null : p.ac,
      conditions: character ? character.conditions : (p.conditions as Array<{ uid: string }>),
      combat: p.combat as { turn?: { turnId: string; ownTurn: boolean; round: number } },
      defeated: p.defeated,
      visibleToPlayers: p.visibleToPlayers,
      canOpenSheet: character?.canOpenSheet ?? false,
    }
  }

  async function characterFacts(
    scope: Scope,
    role: 'dm' | 'player',
    participants: ParticipantRow[],
  ): Promise<Map<string, CharacterFacts>> {
    const facts = new Map<string, CharacterFacts>()
    for (const p of participants) {
      if (p.kind !== 'character' || !p.characterId) continue
      // A deleted character (possible only once every encounter holding it is completed) keeps
      // its participant row as history; the row is shown without sheet facts.
      const view = await deps.commands.view(p.characterId)
      if (!view) continue
      facts.set(p.id, {
        view,
        conditions: view.aggregate.state.conditions.map((c) => ({ uid: c.uid })),
        canOpenSheet: role === 'dm' || scope.role === 'admin' || view.ownerUserId === scope.userId,
      })
    }
    return facts
  }

  return {
    async create(scope: Scope, input: { campaignId: string; name: string }) {
      await deps.campaigns.assertDm(scope, input.campaignId)
      const id = await repo.create(input)
      return { id }
    },

    async get(scope: Scope, encounterId: string) {
      const { encounter, role } = await load(scope, encounterId)
      const participants = await repo.participants(deps.db, encounterId)
      const events = await repo.events(deps.db, encounterId, SUMMARY_LIMIT)
      const order = orderOf(participants)
      const current = encounter.status === 'active' ? order[encounter.turnIndex] : undefined
      const characters = await characterFacts(scope, role, participants)
      // The DM's attack picker: every attack each participant can make.
      const actions: Record<string, Array<{ action: AttackAction; label: string }>> = {}
      if (role === 'dm') {
        for (const p of participants) {
          if (p.kind === 'character' && p.characterId) {
            const facts = characters.get(p.id)
            if (!facts) continue
            const view = facts.view
            actions[p.id] = view.sheet.actionTemplates
              .filter((t) => t.attack)
              .map((t) => ({
                action:
                  t.kind === 'weapon' && t.itemId
                    ? { kind: 'weapon' as const, itemId: t.itemId }
                    : t.kind === 'unarmed'
                      ? { kind: 'unarmed' as const }
                      : { kind: 'action' as const, templateId: t.id },
                label: `${t.name} (${t.attack!.bonus >= 0 ? '+' : ''}${t.attack!.bonus}, ${t.damage.map((d) => d.text).join(' / ')})`,
              }))
          } else if (p.entryUid) {
            const entry = await monsterEntry(p.entryUid, p.versionId)
            actions[p.id] = entry.data.actions
              .map((a, index) => ({ a, index }))
              .filter(({ a }) => a.attack)
              .map(({ a, index }) => ({
                action: { kind: 'monster' as const, index },
                label: `${a.name} (+${a.attack!.toHit}, ${(a.damage ?? []).map((d) => `${d.dice} ${d.damageType}`).join(' / ')})`,
              }))
          }
        }
      }
      return {
        id: encounter.id,
        campaignId: encounter.campaignId,
        name: encounter.name,
        status: encounter.status as 'planned' | 'active' | 'completed',
        round: encounter.round,
        turnIndex: encounter.turnIndex,
        currentTurnId: encounter.currentTurnId,
        currentParticipantId: current?.id ?? null,
        version: encounter.version,
        role,
        participants: order.map((p) => serializeParticipant(p, role, characters.get(p.id))),
        actions,
        events: events.map((e) => serializeEvent(e, role)),
        ...(role === 'dm' ? { dmNotesMd: encounter.dmNotesMd } : {}),
      }
    },

    async addCharacter(scope: Scope, input: { encounterId: string; characterId: string }) {
      const { encounter } = await loadForEdit(scope, input.encounterId)
      const party = await deps.campaigns.get(scope, encounter.campaignId)
      const member = party.characters.find(
        (c) => c.characterId === input.characterId && c.status === 'approved',
      )
      if (!member)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Only approved party characters join encounters.',
        })
      const view = await characterView(input.characterId)
      const ac = view.sheet.stats['ac.total']?.value
      const existing = await repo.participants(deps.db, input.encounterId)
      const id = await repo.addParticipant(deps.db, {
        encounterId: input.encounterId,
        kind: 'character',
        characterId: input.characterId,
        displayName: view.aggregate.name,
        ac: typeof ac === 'number' ? ac : null,
        sortOrder: existing.length,
      })
      await bump(scope, input.encounterId, 'participantAdded', {
        participantId: id,
        name: view.aggregate.name,
      })
      return { participantId: id }
    },

    async addMonster(scope: Scope, input: { encounterId: string; uid: string; count: number }) {
      await loadForEdit(scope, input.encounterId)
      const stored = await deps.content.getEntry(input.uid, { viewer: scope })
      if (!stored || stored.kind !== 'monster')
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Monster not found.' })
      const entry = await monsterEntry(input.uid, stored.version.id)
      const existing = await repo.participants(deps.db, input.encounterId)
      const sameKind = existing.filter((p) => p.entryUid === input.uid).length
      const ids: string[] = []
      for (let n = 0; n < input.count; n += 1) {
        const id = await repo.addParticipant(deps.db, {
          encounterId: input.encounterId,
          kind: 'monster',
          entryUid: input.uid,
          versionId: stored.version.id,
          displayName: `${entry.name} ${sameKind + n + 1}`,
          hpCurrent: entry.data.hitPoints.average,
          hpMax: entry.data.hitPoints.average,
          ac: monsterAc(entry.data),
          sortOrder: existing.length + n,
        })
        ids.push(id)
      }
      await bump(scope, input.encounterId, 'participantAdded', {
        participantIds: ids,
        uid: input.uid,
      })
      return { participantIds: ids }
    },

    async setInitiative(
      scope: Scope,
      input: { encounterId: string; participantId: string; initiative: number },
    ) {
      await loadForEdit(scope, input.encounterId)
      await repo.updateParticipant(deps.db, input.participantId, { initiative: input.initiative })
      await bump(scope, input.encounterId, 'initiativeSet', {
        participantId: input.participantId,
        initiative: input.initiative,
      })
      return { ok: true as const }
    },

    /** Rolls initiative for everyone without one: d20 + the Dexterity modifier (characters: the sheet's bonus). */
    async rollInitiative(scope: Scope, input: { encounterId: string }) {
      await loadForEdit(scope, input.encounterId)
      const participants = await repo.participants(deps.db, input.encounterId)
      const rolled: Array<{ participantId: string; natural: number; total: number }> = []
      for (const p of participants) {
        if (p.initiative !== null) continue
        let bonus = 0
        if (p.kind === 'character' && p.characterId) {
          const view = await characterView(p.characterId)
          const value = view.sheet.stats['initiative.bonus']?.value
          bonus = typeof value === 'number' ? value : 0
        } else if (p.entryUid) {
          const entry = await monsterEntry(p.entryUid, p.versionId)
          bonus = abilityMod(entry.data.abilities.dex)
        }
        const d20 = rollD20({ dice, modifier: bonus })
        await deps.db.insert(schema.rolls).values({
          id: newId(),
          requestedBy: scope.userId ?? null,
          context: { kind: 'initiative', encounterId: input.encounterId, participantId: p.id },
          expression: `1d20 ${bonus >= 0 ? '+' : '-'} ${Math.abs(bonus)}`,
          results: { natural: d20.natural, total: d20.total },
        })
        await repo.updateParticipant(deps.db, p.id, { initiative: d20.total, tiebreak: bonus })
        rolled.push({ participantId: p.id, natural: d20.natural, total: d20.total })
      }
      await bump(scope, input.encounterId, 'initiativeRolled', { rolled })
      return { rolled }
    },

    async start(scope: Scope, input: { encounterId: string; expectedVersion: number }) {
      return advance(scope, input, 'start')
    },

    async nextTurn(scope: Scope, input: { encounterId: string; expectedVersion: number }) {
      return advance(scope, input, 'next')
    },

    async end(scope: Scope, input: { encounterId: string; expectedVersion: number }) {
      const { encounter } = await loadForEdit(scope, input.encounterId)
      if (encounter.version !== input.expectedVersion) throw conflict(encounter.version)
      await repo.update(deps.db, input.encounterId, {
        status: 'completed',
        version: encounter.version + 1,
      })
      await repo.appendEvent(deps.db, {
        encounterId: input.encounterId,
        actorUserId: scope.userId ?? null,
        type: 'ended',
        payload: {},
        versionAfter: encounter.version + 1,
      })
      emitChanged(encounter.campaignId, input.encounterId, encounter.version + 1)
      return { version: encounter.version + 1 }
    },

    /** The attack as it would resolve, without rolling: to-hit, mode, packets and questions. */
    async attackPlan(
      scope: Scope,
      input: {
        encounterId: string
        attackerId: string
        targetId: string
        action: AttackAction
        advantage: RollMode
      },
    ) {
      await loadForDm(scope, input.encounterId)
      const built = await buildPlan(
        input.encounterId,
        input.attackerId,
        input.targetId,
        input.action,
        input.advantage,
      )
      return built.plan
    },

    /** Rolls the attack on the server and stores it for exactly one commit. */
    async attackRoll(
      scope: Scope,
      input: {
        encounterId: string
        attackerId: string
        targetId: string
        action: AttackAction
        advantage: RollMode
      },
    ) {
      await loadForEdit(scope, input.encounterId)
      const built = await buildPlan(
        input.encounterId,
        input.attackerId,
        input.targetId,
        input.action,
        input.advantage,
      )
      let results: StoredAttack['results']
      if (built.plan.kind === 'character') {
        if (built.plan.plan.blocked)
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Cannot attack: ${built.plan.plan.blocked}.`,
          })
        results = rollForPlan(built.plan.plan, dice)
      } else {
        const d20 = rollD20({ dice, mode: built.plan.mode, modifier: built.plan.attackBonus })
        const damage: Record<string, number> = {}
        const details: Record<string, string> = {}
        for (const line of built.plan.damage) {
          const r = rollExpression(line.formula, { dice, critical: d20.isCritical })
          damage[line.id] = r.total
          details[line.id] = r.breakdown
        }
        results = {
          d20: d20.dice,
          monster: {
            natural: d20.natural,
            total: d20.total,
            critical: d20.isCritical,
            damage,
            details,
          },
        }
      }
      const id = newId()
      const context: StoredAttack = {
        kind: 'encounterAttack',
        encounterId: input.encounterId,
        attackerId: input.attackerId,
        targetId: input.targetId,
        plan: built.plan,
        results,
      }
      await deps.db.insert(schema.rolls).values({
        id,
        requestedBy: scope.userId ?? null,
        context,
        expression: built.plan.kind === 'character' ? built.plan.plan.name : built.plan.name,
        results,
      })
      return { rollId: id, plan: built.plan, results }
    },

    /**
     * The coordinator: a retried `commandId` replays the receipt; otherwise one transaction locks
     * the encounter, then the involved characters in ascending id order, checks the version,
     * consumes the roll, applies the attacker's outcome and the target's packets, logs and bumps.
     */
    async commitAttack(
      scope: Scope,
      input: { encounterId: string; commandId: string; rollId: string; expectedVersion: number },
    ) {
      const { encounter } = await loadForEdit(scope, input.encounterId)
      const receipt = await deps.characters.getReceipt(deps.db, input.commandId)
      if (receipt) {
        if (receipt.aggregateId !== input.encounterId)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'That command id was used elsewhere.',
          })
        return { ...(receipt.outcome as CommitOutcome), replayed: true }
      }
      const emits: DomainEvent[] = []
      let outcome: CommitOutcome
      try {
        outcome = await deps.db.transaction(async (tx) => {
          const locked = await repo.get(tx, input.encounterId, { forUpdate: true })
          if (!locked) throw new CommandError('NOT_FOUND', 'encounter not found')
          if (locked.status === 'completed')
            throw new CommandError(
              'PRECONDITION_FAILED',
              'this encounter has ended and cannot be edited',
            )
          if (locked.version !== input.expectedVersion)
            throw new CommandError(
              'CONFLICT',
              `the encounter changed (version ${locked.version}, you expected ${input.expectedVersion})`,
              { version: locked.version },
            )
          if (locked.status !== 'active')
            throw new CommandError('PRECONDITION_FAILED', 'the encounter is not running')
          const [stored] = await tx
            .select()
            .from(schema.rolls)
            .where(eq(schema.rolls.id, input.rollId))
          if (!stored) throw new CommandError('NOT_FOUND', 'roll not found')
          const attack = stored.context as StoredAttack
          if (attack.kind !== 'encounterAttack' || attack.encounterId !== input.encounterId)
            throw new CommandError('BAD_REQUEST', 'that roll belongs to another encounter')
          const participants = await repo.participants(tx, input.encounterId)
          const attacker = participants.find((p) => p.id === attack.attackerId)
          const target = participants.find((p) => p.id === attack.targetId)
          if (!attacker || !target)
            throw new CommandError('NOT_FOUND', 'participant left the encounter')
          // Deterministic lock order: characters by ascending id.
          const characterIds = [attacker.characterId, target.characterId]
            .filter((v): v is string => Boolean(v))
            .sort()
          const revisions = new Map<string, number>()
          for (const id of characterIds) {
            const row = await deps.characters.getRow(tx, id, { forUpdate: true })
            if (!row) throw new CommandError('NOT_FOUND', 'character not found')
            revisions.set(id, row.revision)
          }
          const consumed = await tx
            .update(schema.rolls)
            .set({ consumedByCommandId: input.commandId })
            .where(and(eq(schema.rolls.id, input.rollId), isNull(schema.rolls.consumedByCommandId)))
            .returning({ id: schema.rolls.id })
          if (consumed.length === 0)
            throw new CommandError('PRECONDITION_FAILED', 'that roll was already applied')

          // Attacker side.
          let hit: boolean | null
          let critical: boolean
          let natural: number
          let total: number
          let packets: DamagePacket[] = []
          let name: string
          if (attack.plan.kind === 'character') {
            const result = applyRolls(
              attack.plan.plan,
              attack.results,
              attack.plan.targetAc !== null ? { targetAc: attack.plan.targetAc } : {},
            )
            name = result.name
            hit = result.attack?.hit ?? null
            critical = result.attack?.critical ?? false
            natural = result.attack?.natural ?? 0
            total = result.attack?.total ?? 0
            packets = result.packets
            const request = {
              commandId: input.commandId,
              characterId: attacker.characterId!,
              expectedRevision: revisions.get(attacker.characterId!)!,
              command: { type: 'applyActionOutcome' as const, outcome: result },
              actorUserId: scope.userId ?? null,
            }
            const applied = await deps.commands.applyInTx(tx, request, {
              writeReceipt: false,
              actionId: input.commandId,
            })
            revisions.set(attacker.characterId!, applied.outcome.revision)
            emits.push(deps.commands.changedEvent(request, applied.outcome))
          } else {
            const m = attack.results.monster!
            name = attack.plan.name
            natural = m.natural
            total = m.total
            critical = m.critical
            hit =
              attack.plan.targetAc === null
                ? null
                : natural !== 1 && (critical || total >= attack.plan.targetAc)
            if (hit !== false)
              packets = attack.plan.damage.map((d) => ({
                id: d.id,
                label: name,
                amount: m.damage[d.id] ?? 0,
                damageType: d.damageType,
                flags: {
                  magical: false,
                  silvered: false,
                  adamantine: false,
                  fromSpell: false,
                  weapon: true,
                },
              }))
          }

          // Target side.
          let damageTaken = 0
          let targetHp: { current: number; max: number | null } | null = null
          if (packets.length > 0 && hit !== false) {
            if (target.kind === 'monster' && target.entryUid) {
              const entry = await monsterEntry(target.entryUid, target.versionId)
              const result = applyPackets(
                monsterDefenses(entry.data).defenses,
                { hpCurrent: target.hpCurrent ?? 0, hpTemp: target.hpTemp },
                packets,
              )
              damageTaken = result.damageTaken
              await repo.updateParticipant(tx, target.id, {
                hpCurrent: result.state.hpCurrent,
                hpTemp: result.state.hpTemp,
                defeated: result.state.hpCurrent <= 0,
              })
              targetHp = { current: result.state.hpCurrent, max: target.hpMax }
            } else if (target.characterId) {
              for (const packet of packets) {
                const request = {
                  commandId: newId(),
                  characterId: target.characterId,
                  expectedRevision: revisions.get(target.characterId)!,
                  command: {
                    type: 'applyDamage' as const,
                    amount: packet.amount,
                    damageType: packet.damageType,
                    magical: packet.flags.magical,
                  },
                  actorUserId: scope.userId ?? null,
                }
                const applied = await deps.commands.applyInTx(tx, request, {
                  writeReceipt: false,
                  actionId: input.commandId,
                })
                revisions.set(target.characterId, applied.outcome.revision)
                damageTaken += packet.amount
                targetHp = { current: applied.sheet.hp.current, max: applied.sheet.hp.max }
                emits.push(deps.commands.changedEvent(request, applied.outcome))
              }
            }
          }

          const version = locked.version + 1
          const summary = `${name}: ${hit === null ? 'rolled' : hit ? (critical ? 'critical hit' : 'hit') : 'miss'} (${total})${damageTaken ? `, ${damageTaken} damage to ${target.displayName}` : ''}`
          await repo.appendEvent(tx, {
            encounterId: input.encounterId,
            actorUserId: scope.userId ?? null,
            type: 'attack',
            payload: {
              attackerId: attacker.id,
              targetId: target.id,
              name,
              natural,
              total,
              hit,
              critical,
              packets,
              damageTaken,
              targetHp,
              summary,
            },
            actionId: input.commandId,
            versionAfter: version,
          })
          await repo.update(tx, input.encounterId, { version })
          const stored2: CommitOutcome = {
            version,
            replayed: false,
            summary,
            hit,
            critical,
            natural,
            total,
            damageTaken,
            targetHp,
          }
          await deps.characters.insertReceipt(
            tx,
            input.commandId,
            scope.userId ?? null,
            input.encounterId,
            stored2,
          )
          return stored2
        })
      } catch (error) {
        if (error instanceof CommandError) {
          const code =
            error.code === 'CONFLICT'
              ? 'CONFLICT'
              : error.code === 'NOT_FOUND'
                ? 'NOT_FOUND'
                : error.code === 'PRECONDITION_FAILED'
                  ? 'PRECONDITION_FAILED'
                  : 'BAD_REQUEST'
          throw new TRPCError({ code, message: error.message, cause: error.details })
        }
        throw error
      }
      for (const event of emits) deps.events.emit(event)
      emitChanged(encounter.campaignId, input.encounterId, outcome.version)
      return outcome
    },

    async setCondition(
      scope: Scope,
      input: { encounterId: string; participantId: string; uid: string; active: boolean },
    ) {
      await loadForEdit(scope, input.encounterId)
      const p = await repo.participant(deps.db, input.encounterId, input.participantId)
      if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Participant not found.' })
      if (p.kind === 'character' && p.characterId) {
        const row = await deps.characters.getRow(deps.db, p.characterId)
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
        try {
          await deps.commands.run({
            commandId: newId(),
            characterId: p.characterId,
            expectedRevision: row.revision,
            command: input.active
              ? { type: 'applyCondition', uid: input.uid }
              : { type: 'removeCondition', uid: input.uid },
            actorUserId: scope.userId ?? null,
          })
        } catch (error) {
          if (error instanceof CommandError)
            throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
          throw error
        }
      } else {
        const conditions = (p.conditions as Array<{ uid: string }>).filter(
          (c) => c.uid !== input.uid,
        )
        if (input.active) conditions.push({ uid: input.uid })
        await repo.updateParticipant(deps.db, p.id, { conditions })
      }
      await bump(scope, input.encounterId, 'condition', {
        participantId: p.id,
        uid: input.uid,
        active: input.active,
      })
      return { ok: true as const }
    },

    /** Monster hit points by hand (characters change through their sheet commands). */
    async adjustHp(
      scope: Scope,
      input: { encounterId: string; participantId: string; delta: number },
    ) {
      await loadForEdit(scope, input.encounterId)
      const p = await repo.participant(deps.db, input.encounterId, input.participantId)
      if (!p || p.kind !== 'monster')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only monsters are adjusted here.' })
      const next = Math.max(0, Math.min(p.hpMax ?? 0, (p.hpCurrent ?? 0) + input.delta))
      await repo.updateParticipant(deps.db, p.id, { hpCurrent: next, defeated: next <= 0 })
      await bump(scope, input.encounterId, 'hpAdjusted', {
        participantId: p.id,
        delta: input.delta,
        hpCurrent: next,
      })
      return { hpCurrent: next }
    },

    /**
     * Live updates for the tracker: `encounter.changed` for this encounter and, because character
     * participants change through their own sheets without touching the encounter version
     * (issue #13), `character.changed` for every character in it. The set of characters is
     * refreshed whenever the encounter itself changes (participants are added that way).
     */
    async *subscribe(scope: Scope, encounterId: string, signal: AbortSignal | undefined) {
      const { encounter } = await load(scope, encounterId)
      yield { type: 'ready' as const, encounterId, version: encounter.version }
      let characterIds = new Set<string>()
      const refreshCharacters = async () => {
        const rows = await repo.participants(deps.db, encounterId)
        characterIds = new Set(rows.flatMap((p) => (p.characterId ? [p.characterId] : [])))
      }
      await refreshCharacters()
      const queue: DomainEvent[] = []
      let wake: (() => void) | null = null
      const unsubscribe = deps.events.subscribe((event) => {
        const relevant =
          (event.type === 'encounter.changed' && event.encounterId === encounterId) ||
          (event.type === 'character.changed' && characterIds.has(event.characterId))
        if (!relevant) return
        queue.push(event)
        wake?.()
      })
      try {
        while (!signal?.aborted) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              wake = resolve
              signal?.addEventListener('abort', () => resolve(), { once: true })
            })
            wake = null
          }
          while (queue.length > 0 && !signal?.aborted) {
            const event = queue.shift()!
            if (event.type === 'encounter.changed') await refreshCharacters()
            yield event
          }
        }
      } finally {
        unsubscribe()
      }
    },
  }

  function conflict(version: number): TRPCError {
    return new TRPCError({
      code: 'CONFLICT',
      message: `The encounter changed (version ${version}).`,
      cause: { version },
    })
  }

  function emitChanged(campaignId: string, encounterId: string, version: number): void {
    deps.events.emit({ type: 'encounter.changed', encounterId, campaignId, version })
  }

  /** A small DM edit outside combat resolution: bump the version and log it. */
  async function bump(
    scope: Scope,
    encounterId: string,
    type: string,
    payload: unknown,
  ): Promise<number> {
    const encounter = await repo.get(deps.db, encounterId)
    if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found.' })
    assertEditable(encounter)
    const version = encounter.version + 1
    await repo.update(deps.db, encounterId, { version })
    await repo.appendEvent(deps.db, {
      encounterId,
      actorUserId: scope.userId ?? null,
      type,
      payload,
      versionAfter: version,
    })
    emitChanged(encounter.campaignId, encounterId, version)
    return version
  }

  async function advance(
    scope: Scope,
    input: { encounterId: string; expectedVersion: number },
    how: 'start' | 'next',
  ) {
    const { encounter } = await loadForEdit(scope, input.encounterId)
    const emits: DomainEvent[] = []
    let result: { version: number; round: number; turnIndex: number; turnId: string }
    try {
      result = await deps.db.transaction(async (tx) => {
        const locked = await repo.get(tx, input.encounterId, { forUpdate: true })
        if (!locked) throw new CommandError('NOT_FOUND', 'encounter not found')
        if (locked.status === 'completed')
          throw new CommandError(
            'PRECONDITION_FAILED',
            'this encounter has ended and cannot be edited',
          )
        if (locked.version !== input.expectedVersion)
          throw new CommandError(
            'CONFLICT',
            `the encounter changed (version ${locked.version}, you expected ${input.expectedVersion})`,
            { version: locked.version },
          )
        const participants = await repo.participants(tx, input.encounterId)
        if (participants.length === 0)
          throw new CommandError('PRECONDITION_FAILED', 'add participants first')
        if (participants.some((p) => p.initiative === null))
          throw new CommandError('PRECONDITION_FAILED', 'every participant needs an initiative')
        let round = locked.round
        let turnIndex = locked.turnIndex
        if (how === 'start') {
          if (locked.status === 'active')
            throw new CommandError('PRECONDITION_FAILED', 'the encounter is already running')
          round = 1
          turnIndex = 0
        } else {
          if (locked.status !== 'active')
            throw new CommandError('PRECONDITION_FAILED', 'the encounter is not running')
          const order = orderOf(participants)
          // Skip defeated participants; a full lap with everyone defeated still advances the round.
          let next = turnIndex
          for (let step = 0; step < order.length; step += 1) {
            next += 1
            if (next >= order.length) {
              next = 0
              round += 1
            }
            if (!order[next]!.defeated) break
          }
          turnIndex = next
        }
        const started = await startTurn(
          tx,
          scope,
          input.encounterId,
          participants,
          round,
          turnIndex,
        )
        emits.push(...started.emits)
        const version = locked.version + 1
        await repo.update(tx, input.encounterId, {
          status: 'active',
          round,
          turnIndex,
          currentTurnId: started.turnId,
          version,
          ...(how === 'start' ? { startedAt: new Date() } : {}),
        })
        await repo.appendEvent(tx, {
          encounterId: input.encounterId,
          actorUserId: scope.userId ?? null,
          type: how === 'start' ? 'started' : 'turnStarted',
          payload: { round, turnIndex, turnId: started.turnId },
          versionAfter: version,
        })
        return { version, round, turnIndex, turnId: started.turnId }
      })
    } catch (error) {
      if (error instanceof CommandError) {
        const code =
          error.code === 'CONFLICT'
            ? 'CONFLICT'
            : error.code === 'NOT_FOUND'
              ? 'NOT_FOUND'
              : error.code === 'PRECONDITION_FAILED'
                ? 'PRECONDITION_FAILED'
                : 'BAD_REQUEST'
        throw new TRPCError({ code, message: error.message, cause: error.details })
      }
      throw error
    }
    for (const event of emits) deps.events.emit(event)
    emitChanged(encounter.campaignId, input.encounterId, result.version)
    return result
  }
}

export type CommitOutcome = {
  version: number
  replayed: boolean
  summary: string
  hit: boolean | null
  critical: boolean
  natural: number
  total: number
  damageTaken: number
  targetHp: { current: number; max: number | null } | null
}

export type EncounterService = ReturnType<typeof createEncounterService>
