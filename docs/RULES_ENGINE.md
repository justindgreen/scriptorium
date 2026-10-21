# Rules Engine

`@scriptorium/rules-engine` is a pure TypeScript library. It has no I/O, no clock and no randomness. It runs on the server as the source of truth and in the browser for instant previews. This document is its contract.

```
computeSheet(aggregate, snapshot, ruleset)            -> ComputedSheet          (§2, §3)
planAction(sheet, aggregate, actionRef, ctx)          -> ActionPlan             (§6)
applyRolls(plan, rollResults)                         -> ActionOutcome          (§6)
applyPackets(targetDefenses, targetState, packets)    -> { damageTaken, state } (§6)
applyCommand(aggregate, sheet, command)               -> { patch, event } | error (§8)
```

## 1. Inputs

- **CharacterAggregate**: definition (classes, choices, species, background, base abilities, feats via choices, spells, overrides), inventory (items with equipped/attuned/charges), runtime state (HP, slots, resources, conditions, toggles, combat bookkeeping, assumptions).
- **ContentSnapshot**: the exact pinned `content_versions` the character references plus transitive references. Built by the server from `character_content_refs`.
- **RulesetProfile**: ruleset config tables plus the ruleset-specific algorithms (slot progression, multiclass rules, exhaustion, rests). `srd5.1-2014` first; `srd5.2-2024` later. A character has exactly one profile; cross-ruleset content is refused by validation.

## 2. Static sheet computation

Everything true of the character independent of any attack, target, turn or action: ability scores and modifiers, proficiency bonus, saves, skills, passives, AC, initiative, speeds, HP and hit dice, proficiency sets, senses, size, carrying capacity, spellcasting ability/DC/attack/slots/preparation limits, resource maxima, defenses (symbolic, possibly conditional), and **action templates** (display lines with symbolic dice and conditional riders listed, never rolled).

Pipeline:
1. **Collect grants** in a fixed source order: species → background → class levels in order → subclass → feats → resolved choices → equipped/attuned items → active conditions → active toggles → temporary effects → DM adjustments → manual overrides. Each produces `EffectInstance { effect, source: { kind, uid, name, path }, active, inactiveReason? }`.
2. **Emit pending choices** (§5).
3. **Resolve stats** with the contribution model (§3).
4. **Output** `ComputedSheet`: every value is `{ value, breakdown: [{ source, op, amount, note }], override?: { auto, manual }, error?: true }`, plus `pendingChoices`, `diagnostics`, `actionTemplates`, `spellcasting`, `resources`, `defenses`.

## 3. Contribution model

A stat is a node with a value kind: `number`, `set<string>`, `die`, `boolean`, `formulaGroup`. Effects produce contributions:

```ts
type Contribution = {
  target: StatPath
  op: 'base' | 'replace' | 'add' | 'multiply' | 'atLeast' | 'atMost' | 'replaceFinal' | 'override'
    | 'union' | 'remove'            // set-valued stats
    | 'formula'                     // member of an exclusive formula group (e.g. ac.base)
  value: number | Formula | string[]
  phase?: 'BASE' | 'REPLACE' | 'ADD' | 'MULTIPLY' | 'CLAMP' | 'FINAL' | 'OVERRIDE'  // default from op
  priority?: number                 // default 0; higher wins among replace/replaceFinal
  stackKey?: string                 // adds sharing a key collapse to the single highest
  selection?: 'max' | 'userChoice'  // formula groups; default max
  condition?: Predicate             // static-scope leaves only
  source: SourceRef
  index: number
}
```

Resolution per stat, in phase order:

1. `BASE`: exactly one, supplied by engine/ruleset (`10 + DEX` is the default member of the `ac.base` group; species speed is the `speed.walk` base).
2. `REPLACE`: candidates compete; highest `priority` wins, ties broken by highest value, then source order. Use `atLeast` when the rule means "becomes X if that is higher" (Headband of Intellect: `atLeast 19` on `ability.int.score`).
3. Formula groups: mutually exclusive calculations (AC: `10+DEX`, armor-derived, `13+DEX`, `10+DEX+CON`, `10+DEX+WIS`). Each candidate is evaluated with its own dependencies; the group picks the maximum unless `selection: userChoice` and a stored choice exists. Losing candidates stay in the breakdown.
4. `ADD`: sum; contributions sharing a `stackKey` collapse to the highest (same-named effects do not stack; different sources do).
5. `MULTIPLY`: product (Haste, Slow).
6. `CLAMP`: `value = min(max(value, max(atLeast…)), min(atMost…))`; ability score caps (20, raised by `abilityScore.maxIncrease`) live here.
7. `FINAL`: `replaceFinal` for rules that trump everything (speed 0 while grappled or restrained). Highest priority wins.
8. `OVERRIDE`: the manual override, at most one; the auto value is retained alongside.

Dependencies and evaluation: formulas and static predicate leaves reference other stats. Resolution is **demand-driven with memoisation**: `resolve(path)` evaluates contributions, recursively resolving referenced stats, with a visiting stack. A path already on the stack is a cycle: the engine emits `CYCLE_DETECTED { cycle, effects }`, excludes the contributions that closed the cycle, evaluates from the rest and marks the value `error: true`. Content validation also rejects self-referential formulas and static effects that reference action-scoped facts. Output order is canonical (sorted paths) and contributions are sorted by `(phase, priority desc, sourceOrder, index)`, so results never depend on storage order.

Set-valued stats (proficiencies, languages, resistances, condition immunities, senses) use `union`/`remove`/`replace`; conditional defenses stay symbolic until packets are applied (§6).

## 4. Stat paths, effects, predicates, formulas

**Stat paths:** `ability.<abl>.score|mod|max`, `proficiencyBonus`, `save.<abl>.bonus|proficiency`, `skill.<skill>.bonus|proficiency`, `check.<abl>`, `passive.<skill>`, `ac.base|bonus|total`, `initiative.bonus`, `speed.walk|fly|swim|climb|burrow`, `hp.max|perLevel`, `hitDice.<die>.max`, `attack.melee|ranged|spell|weapon.self|unarmed`, `damage.melee|ranged|weapon.self`, `spell.saveDC|attack|slots.<n>|pact.slots|pact.level|prepared.max|known.max`, `crit.range`, `attacks.perAction`, `resource.<id>.max`, `sense.<type>`, `size`, `carry.capacity`, `defense.resistance|immunity|vulnerability.<damageType>`, `defense.conditionImmunity.<id>`, `roll.advantage|disadvantage.<rollKey>`.

**Static effect catalogue** (discriminated union in `content-schema`; the generated `EFFECTS_REFERENCE.md` is authoritative once it exists):

| Type | Purpose |
|---|---|
| `abilityScore.bonus / atLeast / maxIncrease` | +2 DEX; Headband sets INT to at least 19; raises the cap |
| `proficiency.grant` | kind skill/save/tool/weapon/armor/language, target or filter, level proficient/expertise/half |
| `bonus`, `set`, `atLeast`, `atMost`, `multiply`, `replaceFinal` | generic contributions to a stat path with stackKey/priority/condition |
| `ac.formula` | candidate in the `ac.base` group |
| `advantage / disadvantage` | rollKey (e.g. `save.vs.poison`, `check.stealth`), condition |
| `damage.resistance / immunity / vulnerability`, `condition.immunity` | damage type or condition, optional packet-scope condition |
| `sense.grant`, `speed.set/bonus`, `size.set`, `language.grant` | |
| `attack.extra`, `crit.range`, `weapon.property.grant` | Extra Attack, Improved Critical, finesse for monk weapons under a predicate |
| `hp.bonusPerLevel` | Tough, Hill Dwarf |
| `resource.define` | id, max formula, recharge shortRest/longRest/dawn/turn/custom, display die |
| `spellcasting.grant` | ability, progression full/half/third/pact/none, preparation known/prepared/spellbook, list, ritual, focus |
| `spell.grant`, `spellSlots.bonus` | granted spells with uses/recharge; extra slots |
| `action.grant` | name, actionType, attack, damage formula, save, range, cost, rider text |
| `damage.rider` | scaling damage line displayed on templates (its application is action-scoped) |
| `toggle.define` | named on/off state carrying nested effects (Rage), optional resource cost |
| `choice` | §5 |
| `feature.grant`, `attunement`, `charges`, `hook`, `manual` | nesting; attunement rules; charge pools; registered hooks; descriptive-only mechanics |

**Action-scoped effects** (§6): `action.attackBonus`, `action.damageAdd { formula, damageType, condition, oncePerTurn?, optional? }`, `action.damageReplaceDie`, `action.advantage/disadvantage`, `action.critRange`, `action.rerollDamageDice { values, once }`, `action.onHit`, `action.onCrit`, `action.saveDC`, `action.cost { resource | slot }`, `action.requiresChoice`.

**Predicate DSL** (data, not code): `all / any / not` over leaves. Static leaves: `equipped(self)`, `attuned(self)`, `armor(none|light|medium|heavy)`, `shield(bool)`, `level >= n`, `classLevel(x) >= n`, `ability.score(abl) >= n`, `proficient(path)`, `hasCondition(id)`, `toggle(id)`, `weapon.isMonkWeapon` (for the wielded set). Action leaves: `ctx.weapon.property(p)`, `ctx.weapon.category(c)`, `ctx.attackType`, `ctx.target.type(t)`, `ctx.target.size(s)`, `ctx.target.hasCondition(c)`, `ctx.hasAdvantage`, `ctx.allyAdjacent`, `ctx.firstAttackThisTurn`, `ctx.oncePerTurnAvailable(key)`, `ctx.slotLevel >= n`. Packet leaves: `packet.magical`, `packet.silvered`, `packet.adamantine`, `packet.fromSpell`, `packet.type(t)`. A static effect using an action or packet leaf fails validation (`SCOPE_VIOLATION`). Evaluation is tri-state (`true | false | unknown`); unknown is impossible in static scope and becomes a question in action scope.

**Formula grammar** (shared with `dice/ast`; hand-written parser, never `eval`): integers; `+ - * /`; parentheses; `floor ceil max min`; dice terms `NdX`; variables `STR..CHA` (modifiers), `STRscore..CHAscore`, `PB`, `level`, `classLevel(x)`, `castingMod`, `slotLevel`, `table(name, arg)`. Each target declares which variables are legal; illegal variables fail validation (`UNKNOWN_VARIABLE`).

## 5. Choice points

`choice { key, count, from: optionSet | skill | tool | language | abilityIncrease | feat | content(kind, filter) | expertise(fromProficient), prerequisite? }`. The engine computes the legal options per character (prerequisites, duplicates removed) and emits `pendingChoices`. The builder stores selections under the stable `choice_key` (e.g. `class:srd-5.1:class:fighter@1/fighting-style`); selections grant further effects recursively.

## 6. Contextual action resolution

- **ActionRef**: weapon attack, unarmed strike, spell cast (with slot level), class/item action, or an ad-hoc check/save.
- **ActionContext**: `{ actor, weapon?, attackType, slotLevel?, options: { toggles, resourcesToSpend }, target?: TargetDescriptor, situation: { advantageSources[], disadvantageSources[], allyAdjacentToTarget?, hidden?, firstAttackThisTurn?, range? }, combat: state.combat }`. `TargetDescriptor` is partial; in an encounter the DM's side supplies the real target; on a solo sheet the player answers prompts or relies on stored `assumptions`.
- **planAction** is pure. Unknown facts become `questions[]` with the player's stored default; the plan lists `assumptions[]`. It returns `rolls[]` (attack spec with modifier breakdown and advantage state; damage packet specs with symbolic dice; save spec), `costs[]`, `riders[]`, `oncePerTurnKeys[]`.
- **Roll step** is explicit and outside the engine: the server rolls via `dice/roll` on request, or the user supplies physical results.
- **applyRolls** → `ActionOutcome`: hit/miss/crit, typed `DamagePacket[] { amount, type, flags }`, costs, once-per-turn marks.
- **applyPackets** resolves packets against the target's defenses (static or conditional via packet-scope predicates), producing damage taken and new HP/temp HP. The same function serves characters and monsters.

## 7. Turn bookkeeping (2014 reset rules)

`state.combat` separates four things:

| Field | Meaning | Resets |
|---|---|---|
| `turn.turnId`, `turn.ownTurn` | identity of the current global turn (encounter id + round + turn index); outside encounters a local counter advanced by "New turn" | changes whenever **any** participant's turn begins |
| `oncePerTurn[key] = turnId` | a once-per-turn feature (Sneak Attack) is available when its recorded turnId differs from the current one | effectively on every creature's turn start, so a reaction attack on another creature's turn can trigger it again |
| `reaction.usedOnTurnId` | usable on any creature's turn | regained at the start of the character's **own** turn |
| `bonusAction.usedOnTurnId`, `actions.budget/usedOnTurnId` | only on the character's own turn; Action Surge adds 1 to the budget for that turn | at the start of the character's own turn |

The tracker issues `turnStarted { turnId, ownTurn }` to every participant when the marker moves. Limitation: outside a tracked encounter the bookkeeping is advisory because other creatures' turns are not observed.

## 8. Commands, events, undo

Every write is a command validated and applied by `applyCommand` against the current sheet, returning a patch over the aggregate (definition, inventory and state rows) and an event with `before/after` and `reversible`. Command families: inventory (`addItem`, `removeItem`, `equip`, `unequip`, `attune`, `unattune`, `spendCharges`, `recharge`), state (`applyDamage`, `heal`, `setTempHp`, `spendSlot`, `restoreSlot`, `useResource`, `restoreResource`, `applyCondition`, `removeCondition`, `setExhaustion`, `toggle`, `adjustCurrency`, `setInspiration`, `shortRest`, `longRest`, `turnStarted`, `applyActionOutcome`), definition (`setAbilities`, `setSpecies`, `setBackground`, `addClassLevel`, `removeClassLevel`, `setChoice`, `setSpells`, `setOverride`, `clearOverride`, `setBiography`), and `restoreSnapshot`.

**Undo** issues the compensating command for the most recent event using its recorded `before` values (exact even if content changed). Reversible: damage/heal/temp HP, slot spend/restore, resource use/restore, charges, currency, condition add/remove, exhaustion, toggles, equip/unequip, attune/unattune, inspiration. Not undoable: rests, level-ups and all definition edits, imports, content-update acceptance, snapshot restores; these are covered by snapshots (restore is itself a logged, non-undoable command). Undo is offered only for the latest event, when no non-reversible event follows it, within the last 20 events. These limits are shown in the UI.

## 9. Determinism and automation levels

- The engine never rolls. It depends on `dice/ast` only; dice appear as `DiceExpression` ASTs with formatted text and expected values. HP rolling in the builder is an explicit roll request whose results are stored in `hit_dice_rolls`.
- Every feature declares `automation: { level: 'full' | 'partial' | 'manual', manualParts?: string[], notes? }` and, for `full`/`partial`, at least one behavioural case `tests[]` in its mechanics overlay (format in `TEST_STRATEGY.md`). `full`: all mechanical text is produced by static or action-scoped effects. `partial`: some parts automated and the listed `manualParts` are not. `manual`: descriptive only.
- A feature is **verified** only when its behavioural cases pass through the real engine. A manual placeholder is never evidence that a mechanic works.

## 10. Hooks (controlled extension points)

A registry of named, parameterised TypeScript hooks inside the engine. Content may reference only registered hooks; unknown ids fail validation. 1.0 registry: `spellSlots.multiclass` (internal), `sorcerer.fontOfMagic`, `scalingDieTable`, `unarmoredMovement`. Wild Shape and Polymorph form replacement are not in 1.0 (diagnostic + manual).

## 11. Diagnostics

Structured `{ code, severity, message, statPath?, sources[] }`. Codes: `CYCLE_DETECTED`, `UNKNOWN_VARIABLE`, `SCOPE_VIOLATION`, `UNSUPPORTED_EFFECT`, `UNKNOWN_HOOK`, `CONFLICTING_REPLACE`, `PREREQ_UNMET`, `PROFICIENCY_VIOLATION` (with the automatic consequences applied: disadvantage on STR/DEX checks, saves and attacks and no spellcasting in unproficient armor), `MANUAL_FEATURE`, `PARTIAL_AUTOMATION`.

## 12. Ambiguity register

Record each ambiguous 2014 rule with the assumption taken and the test that pins it.

| Id | Rule | Assumption | Test |
|---|---|---|---|
| (none yet) | | | |

## 13. Manual-feature allow-list (official content)

Features whose mechanics are legitimately descriptive and therefore `manual`, each with a one-line reason, reviewed by the owner. Populated from M2.4 onward.

| Feature | Reason |
|---|---|
| (none yet) | |
