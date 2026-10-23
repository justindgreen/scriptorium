# Rules Engine

`@scriptorium/rules-engine` is a pure TypeScript library. It has no I/O, no clock and no randomness. It runs on the server as the source of truth and in the browser for instant previews. This document is its contract.

```
computeSheet(aggregate, snapshot, ruleset)            -> ComputedSheet          (§2, §3)
planAction(sheet, aggregate, actionRef, ctx, snapshot?) -> ActionPlan            (§6)
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

**Implementation notes (M2.2).** The engine adds no hidden bonuses: a shield is an item of category `shield` whose `+2` is an ordinary `bonus ac.bonus` effect on the item (the SRD converter emits it), armor AC comes from the item's structured `armor` data as a member of the `ac.base` formula group, and weapon lines come from structured `weapon` data. Effects on an item that target `attack.weapon.self` / `damage.weapon.self` apply only to that item's own templates. Item effects are active while the item is equipped (and attuned when it requires attunement); a second equipped shield or suit of armor is inactive with a warning. Exhaustion (2014 table) and the consequences of unproficient armor (disadvantage on STR/DEX checks, saves and attacks; `speed.walk -10` below the heavy-armor Strength minimum; Stealth disadvantage) are engine rules. Hit points: first character level maxed, then the fixed average or the stored roll per level, each level at least 1, plus `hp.perLevel` (CON modifier plus `hp.bonusPerLevel`) per level. Passive scores add or subtract 5 under advantage or disadvantage on that check. Static formulas never evaluate dice; a formula with dice belongs on an action template (`FORMULA_ERROR` otherwise). Spellcasting effects (`spellcasting.grant`, `spellSlots.bonus`, `spell.grant`) are collected during the grants walk and computed by the spellcasting module (M2.3); the spellcasting module emits a `PARTIAL_AUTOMATION` info per granted spell, naming it ("<source> grants Bless (1 charge); casting it from the sheet is not automated yet"), because the grant is listed with its uses or charges but casting it from the sheet is not automated (D-4, M3.2). Ability-score method rules (standard array once each, point buy range and budget) are the exported `validateAbilityScores`, used by the `setAbilities` command and by character creation (A1-R). `setBackground` drops the stored selections under the previous background's choice keys (`background:<uid>/…`) when the background changes or is cleared, so a returning background starts its choices afresh (ADR-0040).

**Inventory view (M2.7).** `sheet.items` lists every inventory row as the engine resolved it: the content name, category, quantity, equipped and attuned flags, whether its effects are active and why not (`not equipped`, `not attuned`, a duplicate shield or armor, `content missing`), and current and maximum charges. The UI shows names and states from here rather than deriving them from uids.

## 3. Contribution model

A stat is a node with a value kind: `number`, `set<string>`, `die`, `boolean`, `formulaGroup`. Effects produce contributions:

```ts
type Contribution = {
  target: StatPath
  op:
    | 'base'
    | 'replace'
    | 'add'
    | 'multiply'
    | 'atLeast'
    | 'atMost'
    | 'replaceFinal'
    | 'override'
    | 'union'
    | 'remove' // set-valued stats
    | 'formula' // member of an exclusive formula group (e.g. ac.base)
  value: number | Formula | string[]
  phase?: 'BASE' | 'REPLACE' | 'ADD' | 'MULTIPLY' | 'CLAMP' | 'FINAL' | 'OVERRIDE' // default from op
  priority?: number // default 0; higher wins among replace/replaceFinal
  stackKey?: string // adds sharing a key collapse to the single highest
  selection?: 'max' | 'userChoice' // formula groups; default max
  condition?: Predicate // static-scope leaves only
  source: SourceRef
  index: number
}
```

Resolution per stat, in phase order:

1. `BASE`: exactly one, supplied by engine/ruleset (`10 + DEX` is the default member of the `ac.base` group; species speed is the `speed.walk` base).
2. `REPLACE`: candidates compete; highest `priority` wins, ties broken by highest value, then source order. Use `atLeast` when the rule means "becomes X if that is higher" (Headband of Intellect: `atLeast 19` on `ability.int.score`).
3. Formula groups: mutually exclusive calculations (AC: `10+DEX`, armor-derived, `13+DEX`, `10+DEX+CON`, `10+DEX+WIS`). Each candidate is evaluated with its own dependencies; the group picks the maximum unless `selection: userChoice` and a stored choice exists (stored under the choice key `stat:<path>`, e.g. `stat:ac.base`, as an `optionSet` selection naming the member's label). Losing candidates stay in the breakdown.
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

| Type                                                                 | Purpose                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `abilityScore.bonus / atLeast / maxIncrease`                         | +2 DEX; Headband sets INT to at least 19; raises the cap                                                  |
| `proficiency.grant`                                                  | kind skill/save/tool/weapon/armor/language, target or filter, level proficient/expertise/half             |
| `bonus`, `set`, `atLeast`, `atMost`, `multiply`, `replaceFinal`      | generic contributions to a stat path with stackKey/priority/condition                                     |
| `ac.formula`                                                         | candidate in the `ac.base` group                                                                          |
| `advantage / disadvantage`                                           | rollKey (e.g. `save.vs.poison`, `check.stealth`), condition                                               |
| `damage.resistance / immunity / vulnerability`, `condition.immunity` | damage type or condition, optional packet-scope condition                                                 |
| `sense.grant`, `speed.set/bonus`, `size.set`, `language.grant`       |                                                                                                           |
| `attack.extra`, `crit.range`, `weapon.property.grant`                | Extra Attack, Improved Critical, finesse for monk weapons under a predicate                               |
| `hp.bonusPerLevel`                                                   | Tough, Hill Dwarf                                                                                         |
| `resource.define`                                                    | id, max formula, recharge shortRest/longRest/dawn/turn/custom, display die                                |
| `spellcasting.grant`                                                 | ability, progression full/half/third/pact/none, preparation known/prepared/spellbook, list, ritual, focus |
| `spell.grant`, `spellSlots.bonus`                                    | granted spells with uses/recharge; extra slots                                                            |
| `action.grant`                                                       | name, actionType, attack, damage formula, save, range, cost, rider text                                   |
| `damage.rider`                                                       | scaling damage line displayed on templates (its application is action-scoped)                             |
| `toggle.define`                                                      | named on/off state carrying nested effects (Rage), optional resource cost                                 |
| `choice`                                                             | §5                                                                                                        |
| `feature.grant`, `attunement`, `charges`, `hook`, `manual`           | nesting; attunement rules; charge pools; registered hooks; descriptive-only mechanics                     |

**Action-scoped effects** (§6): `action.attackBonus`, `action.damageAdd { formula, damageType, condition, oncePerTurn?, optional? }`, `action.damageReplaceDie`, `action.advantage/disadvantage`, `action.critRange`, `action.rerollDamageDice { values, once }`, `action.onHit`, `action.onCrit`, `action.saveDC`, `action.cost { resource | slot }`, `action.requiresChoice`.

**Predicate DSL** (data, not code): `all / any / not` over leaves. Static leaves: `equipped(self)`, `attuned(self)`, `armor(none|light|medium|heavy)`, `shield(bool)`, `level >= n`, `classLevel(x) >= n`, `ability.score(abl) >= n`, `proficient(path)`, `hasCondition(id)`, `toggle(id)`, `weapon.isMonkWeapon` (for the wielded set). Action leaves: `ctx.weapon.property(p)`, `ctx.weapon.category(c)`, `ctx.attackType`, `ctx.spell(uid)` (the spell being cast, for Agonizing Blast), `ctx.target.type(t)`, `ctx.target.size(s)`, `ctx.target.hasCondition(c)`, `ctx.hasAdvantage`, `ctx.allyAdjacent`, `ctx.firstAttackThisTurn`, `ctx.oncePerTurnAvailable(key)`, `ctx.slotLevel >= n`. Packet leaves: `packet.magical`, `packet.silvered`, `packet.adamantine`, `packet.fromSpell`, `packet.type(t)`. A static effect using an action or packet leaf fails validation (`SCOPE_VIOLATION`). Evaluation is tri-state (`true | false | unknown`); unknown is impossible in static scope and becomes a question in action scope.

**Formula grammar** (shared with `dice/ast`; hand-written parser, never `eval`): integers; `+ - * /` with unary minus; parentheses; `floor ceil max min abs`; dice terms `NdX` (`d%` = d100) with optional modifiers `khN kl N` / `dhN dlN` (keep or drop, one per term), `rV,V` (reroll those faces until another shows) or `roV,V` (reroll them once), and `minN` (raise lower faces); variables `STR..CHA` (modifiers), `STRscore..CHAscore`, `PB`, `level`, `classLevel(x)`, `castingMod` (alias `MOD`, the spell source's ability modifier), `slotLevel` (only while casting), `table(name, arg)` with quoted names as function arguments, and `dice(count, faces)` for dice whose count is computed (`dice(ceil(classLevel('srd-5.1:class:rogue') / 2), 6)` is Sneak Attack); after variables are substituted and constants folded, `dice(3, 6)` becomes the ordinary term `3d6`. Each target declares which variables are legal; illegal variables fail validation (`UNKNOWN_VARIABLE`). Limits: 200 characters, 1–100 dice of 2–1000 faces per term, nesting depth 24. Content formulas validated by `content-schema` use the `NdX` and keep/drop subset; rerolls and minimums are applied by the roll step from action effects (`action.rerollDamageDice`).

**Dice package** (`packages/dice`): `dice/ast` parses to a tree (`parse` never throws; `validate` checks variables and functions against an allow-list), formats canonically (`format(parse(text))` is stable), analyses (`range`, `collectVariables`, `multiplyDice` for critical hits: every dice term is doubled, keep/drop counts scale, flat modifiers do not) and computes exact expected values (`expectedValue`: closed form for rerolls, minimums and keep/drop via order statistics; `null` when no exact expectation exists, such as dice inside `floor`). `dice/roll` evaluates with an injected die roller (`createCryptoRng` in production, `createSeededRng` in tests, `scriptedDice` for physical dice) and returns the total (rounded down, the 5e rule), the unrounded value, a breakdown string (`2d6 [4, ~2] + 3`, where `~` marks a dropped die) and structured terms with reroll history and raised faces; `rollD20` handles advantage, disadvantage, critical range and natural ones, and `resolveMode` cancels advantage against disadvantage. Ties in keep/drop are broken by roll order, so results are deterministic for a given die sequence.

## 5. Choice points

`choice { key, count, from: optionSet | skill | tool | language | abilityIncrease | feat | content(kind, filter) | expertise(fromProficient), prerequisite? }`. The engine computes the legal options per character (prerequisites, duplicates removed) and emits `pendingChoices`. The builder stores selections under the stable `choice_key` = `<owner path>/<choice key>`, where the owner path is the grants path of the entry declaring the choice (e.g. `class:srd-5.1:class:fighter@1/feature:fighter-fighting-style/fighting-style`; class skill choices use `class:<uid>@1/skills`, background languages `background:<uid>/languages`). A selection is typed by the choice kind (`{ kind: 'skill', skills: [...] }`, `{ kind: 'optionSet', options: [...] }`, `{ kind: 'abilityIncrease', increases: {...} }`, `{ kind: 'asiOrFeat', choice, increases?, feat? }`, …); a selection of the wrong kind or with illegal entries is reported (`INVALID_SELECTION`) and ignored. Options the engine can enumerate (option sets, skills, tools, languages, abilities) are listed on the pending choice with `disabledReason` when a prerequisite is unmet; feats and content choices are enumerated by the server. Selections grant further effects recursively (an option's effects or feature, a feat's effects and choices). `count` may be a static formula evaluated from the facts known during the grants walk (`table('invocations-known', classLevel('…'))`; ability modifiers and PB are not available there). `content` choices grant their picks: features (filtered by tags, e.g. invocations) are expanded like any granted feature; spells (filtered by list, level, `maxLevel`, school) become known, always-prepared spells with origin `choice:<key>` that do not count against preparation limits (Mystic Arcanum, Pact of the Tome, the high-elf cantrip); other content kinds are reported as unsupported. Picks that fail the filter are reported (`INVALID_SELECTION`) and still applied so the sheet stays honest about what was stored.

## 6. Contextual action resolution

- **ActionRef**: weapon attack, unarmed strike, spell cast (with slot level), class/item action, or an ad-hoc check/save.
- **ActionRef**: `{ kind: 'weapon', itemId, twoHanded? }`, `{ kind: 'unarmed' }`, `{ kind: 'action', templateId }` (an `action.grant` template), `{ kind: 'spell', spellUid, slotLevel?, sourceId?, usePact? }`, `{ kind: 'check', skill? | ability? }`, `{ kind: 'save', ability }`.
- **ActionContext**: `{ target?: { creatureType?, size?, conditions?, ac?, defenses? }, situation?: { advantageSources[], disadvantageSources[], allyAdjacentToTarget?, hidden?, firstAttackThisTurn?, range? }, options?: { declineOptional[], answers } }`; the actor, its weapon facts and `state.combat` come from the sheet and the aggregate. `TargetDescriptor` is partial; in an encounter the DM's side supplies the real target; on a solo sheet the player answers prompts or relies on stored `assumptions`.
- **planAction** is pure. It resolves the base (weapon template, unarmed strike, granted action, spell entry, check or save), settles advantage and disadvantage first (situation sources, sheet flags, `action.advantage/disadvantage`; any of both cancels), then applies the action-scoped effects whose `appliesTo` matches (`attack.weapon.self` effects only on their own item). Unknown facts (`ctx.allyAdjacent`, target type, size or condition, first attack this turn) become `questions[]` answered from `options.answers`, else `state.assumptions`, else a default; every assumed answer is listed in `assumptions[]`. The plan carries `attack` (bonus with breakdown, mode, crit range), `save`, `check`, `damage[]` packet specs with symbolic dice (`formula` and `critFormula` with every die doubled; weapon dice shaped by `action.damageReplaceDie` and `action.rerollDamageDice`, e.g. `2d6ro1,2 + 3`), `excluded[]` (once-per-turn already used, declined), `costs[]` with availability, `economy` (action, bonus action or reaction availability from `state.combat`), `riders[]`, `oncePerTurnKeys[]`, `healing`, `concentration` and `blocked` when the action cannot be taken (no slot, unknown spell, unequipped weapon, armor without proficiency). Spells pick the lowest free slot of at least the spell's level unless `slotLevel` or `usePact` says otherwise; cantrips cost nothing.
- **Roll step** is explicit and outside the engine: the server rolls via `dice/roll` on request, or the user supplies physical results. Implementation (M2.6): `characters.plan` returns the plan for a ref and context without touching state; `characters.roll` plans again on the server, rolls the attack or check (two d20 under advantage or disadvantage), every damage packet (with `critFormula` when the attack was a critical) and the healing with the cryptographic RNG, and stores the roll in `rolls` with its plan; `characters.commitAction` loads the stored roll, derives the outcome with `applyRolls` (with the target AC when given) and runs `applyActionOutcome` in the same transaction that marks the roll consumed (`consumed_by_command_id`, unique), so one roll is applied at most once and a retried command id replays the receipt. Checks and saves are rolled and shown but not committed (nothing to spend). Hit dice for rests and rolled level-ups come from `characters.rollHitDie`, which is also recorded in `rolls`.
- **applyRolls(plan, rolls, { targetAc? })** → `ActionOutcome`: the natural roll decides critical (at or above `critRange`) and natural 1; with a known AC the total decides hit or miss, otherwise `hit` is null and the table decides. Damage totals are inputs by packet id (rolled with `critFormula` on a critical); a missing roll is an error, never a guess. A miss yields no packets and no once-per-turn marks; a hit marks `oncePerTurnKeys` and the action economy slot used.
- **applyPackets(defenses, { hpCurrent, hpTemp }, packets)** resolves packets against the target's defenses (unconditional, or conditional via packet-scope predicates such as `packet.magical`; static leaves are answered by a callback for characters): immunity zeroes, resistance halves once, then vulnerability doubles once (2014 order); temporary hit points absorb first. The same function serves characters and monsters; `monsterDefenses(data)` parses SRD stat-block lines ("bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered", "damage from spells") into structured defenses and reports the lines it cannot read.
- **Spellcasting on the sheet** (`sheet.spellcasting`): sources from class data (and subclass third casters), overridden by `spellcasting.grant` effects from the same class or added as innate sources; slots from the class's own table when exactly one spellcasting class, else from the multiclass table at Σ full + ⌊half/2⌋ + ⌊third/3⌋ levels; pact magic separate (`spell.pact.slots/level`); `spell.saveDC` = 8 + PB + modifier and `spell.attack` = PB + modifier of the primary source (first spellcasting class in order), per-source values in the view; prepared maximum = modifier + class level (half casters: half the level), minimum 1, or `preparedFormula`; known and cantrip limits from the class level rows; subclass always-prepared spells by level; `spell.grant` effects listed as granted spells; spells not on the class list, over the prepared, known or cantrip limit are reported (`INVALID_SELECTION`). Armor without proficiency blocks casting (`blocked`).

## 7. Turn bookkeeping (2014 reset rules)

`state.combat` separates four things:

| Field                                                     | Meaning                                                                                                                            | Resets                                                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `turn.turnId`, `turn.ownTurn`                             | identity of the current global turn (encounter id + round + turn index); outside encounters a local counter advanced by "New turn" | changes whenever **any** participant's turn begins                                                               |
| `oncePerTurn[key] = turnId`                               | a once-per-turn feature (Sneak Attack) is available when its recorded turnId differs from the current one                          | effectively on every creature's turn start, so a reaction attack on another creature's turn can trigger it again |
| `reaction.usedOnTurnId`                                   | usable on any creature's turn                                                                                                      | regained at the start of the character's **own** turn                                                            |
| `bonusAction.usedOnTurnId`, `actions.budget/usedOnTurnId` | only on the character's own turn; Action Surge adds 1 to the budget for that turn                                                  | at the start of the character's own turn                                                                         |

The tracker issues `turnStarted { turnId, ownTurn }` to every participant when the marker moves. Limitation: outside a tracked encounter the bookkeeping is advisory because other creatures' turns are not observed. Implementation (M2.8): turn ids are `<encounterId>:<round>:<turnIndex>`; the encounter service issues the commands inside the transaction that moves the marker and skips defeated participants when it advances.

## 8. Commands, events, undo

Every write is a command validated and applied by `applyCommand` against the current sheet, returning a patch over the aggregate (definition, inventory and state rows) and an event with `before/after` and `reversible`. Command families: inventory (`addItem` (a charged item arrives with full charges unless the command sets them), `removeItem`, `equip`, `unequip`, `attune`, `unattune`, `spendCharges`, `recharge`), state (`applyDamage`, `heal`, `setTempHp`, `spendSlot`, `restoreSlot`, `useResource`, `restoreResource`, `applyCondition`, `removeCondition`, `setExhaustion`, `toggle`, `adjustCurrency`, `setInspiration`, `shortRest`, `longRest`, `turnStarted`, `applyActionOutcome`), definition (`setAbilities`, `setSpecies`, `setBackground`, `addClassLevel`, `removeClassLevel`, `setChoice`, `setSpells`, `setOverride`, `clearOverride`, `setBiography`), and `restoreSnapshot`.

**Implementation (M2.5).** `applyCommand(aggregate, sheet, command, { snapshot, ruleset })` returns `{ patch, event, aggregate }` or a structured error (`NOT_FOUND`, `INVALID`, `INSUFFICIENT`, `LIMIT`, `PREREQ_UNMET`, `UNSUPPORTED`). A patch names the sections it replaces (`name`, `definition`, `inventory`, `state`); the event records those sections before and after, `reversible`, a `snapshotReason` (`level_up` for class-level changes, `rest` for rests) and a one-line summary. Validation uses the sheet: attunement needs an attunable item and at most three, slots and resources must be available, hit die rolls must fit the class die, multiclassing checks the prerequisite predicates of the new class and of every current class (2014), subclasses need the class level, abilities are checked against the standard array or the point-buy budget. Rests: a short rest spends the listed hit dice (each given as what the die showed; the engine adds the Constitution modifier with a minimum of 0 per die and refuses a result the die cannot show) and restores short-rest resources and pact slots; a long rest restores everything, half the hit dice (largest first, at least one) and one exhaustion level. `turnStarted` with `ownTurn` clears the reaction, bonus action and action marks; `applyActionOutcome` pays costs, marks once-per-turn keys and the action economy, and starts concentration.

**Undo** issues the compensating command for the most recent event using its recorded `before` values (exact even if content changed): the `undo` command writes those sections back and is itself logged (not reversible). Reversible: damage/heal/temp HP, slot spend/restore, resource use/restore, charges, currency, condition add/remove, exhaustion, toggles, equip/unequip, attune/unattune, inspiration. Not undoable: rests, level-ups and all definition edits, imports, content-update acceptance, snapshot restores; these are covered by snapshots (restore is itself a logged, non-undoable command). Undo is offered only for the latest event, when no non-reversible event follows it, within the last 20 events. These limits are shown in the UI (the History panel states them and the undo button names the reason when it is unavailable).

## 9. Determinism and automation levels

- The engine never rolls. It depends on `dice/ast` only; dice appear as `DiceExpression` ASTs with formatted text and expected values. HP rolling in the builder is an explicit roll request whose results are stored in `hit_dice_rolls`.
- Every feature declares `automation: { level: 'full' | 'partial' | 'manual', manualParts?: string[], notes? }` and, for `full`/`partial`, at least one behavioural case `tests[]` in its mechanics overlay (format in `TEST_STRATEGY.md`). `full`: all mechanical text is produced by static or action-scoped effects. `partial`: some parts automated and the listed `manualParts` are not. `manual`: descriptive only.
- A feature is **verified** only when its behavioural cases pass through the real engine. A manual placeholder is never evidence that a mechanic works.

## 10. Hooks (controlled extension points)

A registry of named, parameterised TypeScript hooks inside the engine. Content may reference only registered hooks; unknown ids fail validation. 1.0 registry: `spellSlots.multiclass` (internal), `sorcerer.fontOfMagic`, `scalingDieTable`, `unarmoredMovement`. Wild Shape and Polymorph form replacement are not in 1.0 (diagnostic + manual). Status: `unarmoredMovement { column, class? }` is implemented (expands to a conditional `speed.bonus` from the class table); `scalingDieTable` and `sorcerer.fontOfMagic` are registered but report `UNSUPPORTED_EFFECT` until M2.4 / M3.2.

## 11. Diagnostics

Structured `{ code, severity, message, statPath?, sources[] }`. Codes: `CYCLE_DETECTED`, `UNKNOWN_VARIABLE`, `SCOPE_VIOLATION`, `UNSUPPORTED_EFFECT`, `UNKNOWN_HOOK`, `CONFLICTING_REPLACE`, `PREREQ_UNMET`, `PROFICIENCY_VIOLATION` (with the automatic consequences applied: disadvantage on STR/DEX checks, saves and attacks and no spellcasting in unproficient armor), `MANUAL_FEATURE`, `PARTIAL_AUTOMATION`, `FORMULA_ERROR` (a static formula that cannot be evaluated to a number: syntax, dice, unknown table), `MISSING_CONTENT` (a referenced uid is not in the snapshot), `INVALID_SELECTION` (a stored choice selection or override that is illegal), `HP_ROLL_MISSING` (rolled hit points without a stored roll; the average was used). Severity: `error` for cycles, formula and scope problems and missing content; `warning` for conflicts, prerequisites, proficiency violations and invalid selections; `info` for manual/partial/pending features and deferred effects.

## 12. Ambiguity register

Record each ambiguous 2014 rule with the assumption taken and the test that pins it.

| Id    | Rule                                                                    | Assumption                                                                                                                                                                               | Test                                               |
| ----- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| A-001 | Multiclass saving throw proficiencies                                   | Only the first class taken (`order` 0) grants saving throw proficiencies; later classes grant the multiclassing proficiencies listed on the class (PHB multiclassing table)              | `multiclass-fighter-1-rogue-1`                     |
| A-002 | `castingMod` for a character with several spellcasting sources          | Resolves to the ability of the first active `spellcasting.grant`, else the first class with spellcasting data; revisited with per-class spellcasting in M2.3                             | `formula-and-choices.test.ts`                      |
| A-003 | `table(name, level)` when more than one class has a column of that name | The first class in order whose level table has the column is used                                                                                                                        | `hill-dwarf-champion-5` (Action Surge)             |
| A-004 | Keep/drop ties in dice pools                                            | Ties are broken by roll order (the earlier die is kept) so a given die sequence always yields the same result                                                                            | `dice/test/roll.test.ts`                           |
| A-005 | Which slot a spell uses                                                 | The lowest free slot of at least the spell's level; a warlock's pact slot is used when the source is pact magic or no ordinary slot fits (`usePact` overrides)                           | `spellcasting-cleric-5-life`, `spellcasting-slots` |
| A-006 | Critical hits and extra damage dice                                     | Every dice term in every damage packet is doubled (weapon dice, Sneak Attack, riders), flat bonuses are not; the attack's crit range applies to all packets                              | `actions-rogue-sneak-attack`                       |
| A-007 | Great Weapon Fighting and versatile weapons                             | Rerolls apply when the weapon is used two-handed (`ctx.twoHanded`), including a versatile weapon held in two hands, and only to the weapon's own dice                                    | `actions-fighter-great-weapon-fighting`            |
| A-008 | Sneak Attack availability                                               | Once per turn keyed on `state.combat.oncePerTurn`, available again on another creature's turn; "advantage" means the final roll mode is advantage (cancelled advantage does not qualify) | `actions-rogue-sneak-attack`                       |

| A-009 | Short rest hit dice: the 2014 text says each die restores the roll plus the Constitution modifier; it is read per die with a minimum of 0 per die (a negative modifier never reduces other dice), and the total is capped at the hit point maximum. |

## 13. Manual-feature allow-list (official content)

Features whose mechanics are legitimately descriptive and therefore `manual`, each with a one-line reason, reviewed by the owner. Populated from M2.4 onward.

| Feature    | Reason |
| ---------- | ------ |
| (none yet) |        |
