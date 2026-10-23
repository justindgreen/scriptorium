# Alpha Gate (A1) review

Date: 2026-10-22. Repository state audited: `main` at d9d6195 (M2.8). Reviewer: the implementation session, acting as an independent audit per the owner's A1 brief. Nothing in this document marks A1 verified; the recommendation at the end is for the owner's decision.

## 1. Executive summary

The playable alpha works end to end on alpha content: a DM installs, invites, a player builds and levels a character, the DM authors and shares a homebrew weapon, grants it, runs an encounter with initiative, turns and attacks through the coordinator, the server restarts mid-combat, a retried attack applies once, and a backup restores into a fresh instance with byte-identical computed sheets. All suites are green (lint, format, typecheck, 324 unit and integration tests, 51 E2E tests, 336 behavioural conformance cases, build) and the two-instance restore acceptance passed 27 of 27 checks.

Four concerns stand between this and an unconditional pass:

1. **The automation gate is not met and cannot be met by reclassification.** Alpha class and subclass features at full or partial automation are 94 of 149 rows (63.1%), or 94 of 115 non-placeholder rows (81.7%), against a ≥ 95% threshold. Even after excluding the 10 manual rows that are genuinely narrative or table-adjudicated, the share is 89.5%. Eleven mechanical features remain manual, and six of them conflict with the separate requirement that every numeric or resource-bearing feature be `full` (§4).
2. **SRD spells carry no damage dice.** The planner supports spell damage by slot level, but the converted package has empty `damage` blocks for every spell (0 of 327 with usable dice), so a spell action card never produces a damage packet. Casting works for costs and the attack roll only (§7, D-1).
3. **No death saving throws.** At 0 hit points the sheet shows `0 / max` and nothing else; the state field exists but no command or control does (§7, D-2).
4. **A player-visible information leak in the encounter log.** The player role is stripped of monster hit points in the participant list, but the attack events in the same response carry `targetHp` and `damageTaken`, so a player can read a monster's remaining hit points from the log (§7, D-3).

Recommendation: **CONDITIONAL PASS** (§9). The foundation is sound; the conditions are the owner's decision on the coverage gate and three small fixes (D-3, D-6, D-7) before Phase 3 work starts.

## 2. Acceptance matrix

| Gate requirement (source)                                                                                                         | Status           | Evidence                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every `full`/`partial` feature in the alpha set verified by a passing behavioural case (TEST_STRATEGY §4)                         | PASS             | `pnpm coverage:automation`: 336 verified, 0 unverified, 0 declaration violations                                                                                          |
| (a) Every numeric or resource-bearing alpha feature is `full` (TEST_STRATEGY §4, plan §11)                                        | PARTIAL          | Two-Weapon Fighting, Disciple of Life, Dark One's Blessing, Survivor, Reliable Talent are `manual`; Remarkable Athlete is `partial` with a numeric manual part (§4.3)     |
| (b) ≥ 95% of alpha class/subclass features `full` or `partial`                                                                    | FAIL             | 63.1% of 149 rows; 81.7% of 115 non-placeholder rows; 89.5% after narrative waivers (§4)                                                                                  |
| (d) Every `manual` alpha feature on the allow-list with a reason                                                                  | PASS             | 63 entries, 0 off-list (`content/srd-5.1/mechanics/manual-allowlist.json`)                                                                                                |
| (e) Every alpha class computes at every level 1–20 with no engine errors, no hooks outside the registry                           | PASS             | `tools/conformance/test/alpha-levels.test.ts` (18 tests, levels 1–20 for Fighter, Rogue, Cleric, Warlock and both multiclass builds)                                      |
| Engine never rolls; `dice/roll` unreachable from the engine (CLAUDE.md rule 2)                                                    | PASS             | No impure import in `packages/rules-engine/src`; lint boundary in `eslint.config.ts` lines 59–66; only `@scriptorium/content-schema` and `@scriptorium/dice/ast` imported |
| M2.5: each alpha class built at L1 and levelled to 5; prerequisites; 409; events with before/after                                | PASS             | `e2e/characters.spec.ts` (3 viewports), `apps/server/test/characters.test.ts`                                                                                             |
| M2.6: every control persists and survives restart; undo limits; mobile; no dead controls                                          | PASS with a note | `e2e/sheet.spec.ts` (3 viewports), `e2e/restart.spec.ts`; the undo window check is dead code (§7, D-8)                                                                    |
| M2.7: the specification's sword created through the form, assigned, mechanics on sheet and in plans                               | PASS             | `e2e/homebrew.spec.ts` (3 viewports), `apps/server/test/homebrew.test.ts`                                                                                                 |
| M2.8: acceptance scenario on alpha content with a restart mid-encounter and a retried attack applying once                        | PASS             | `e2e/acceptance.spec.ts` (desktop, own project after `restart`)                                                                                                           |
| Restore acceptance against a second instance with a character (TEST_STRATEGY §5, Gate A1)                                         | PASS             | §6: 27 checks incl. identical `ComputedSheet` JSON, pinned homebrew version, campaign, encounter, uploads sha256                                                          |
| Acceptance scenario covers install → account → character → level-up → homebrew → campaign → encounter → attack → restart → replay | PASS (desktop)   | §5; the restart and acceptance specs run on desktop only; builder, sheet and homebrew specs run on tablet and phone too                                                   |

## 3. Architecture review

Strengths, confirmed in code:

- **Pure engine.** `computeSheet`, `planAction`, `applyRolls`, `applyPackets` and `applyCommand` take data and return data; the resolver evaluates contributions in canonical order (`static/resolver.ts` lines 143, 170) with cycle detection that drops the closing contribution and reports `CYCLE_DETECTED`. Dice appear only as formulas until the server's roll step (`modules/characters/rolls.ts`, `modules/encounters/service.ts`).
- **One write path.** Every character change goes through `core/commands.ts` (`applyInTx`): row lock, revision check, engine patch, event with before/after, snapshot, pinned refs, receipt. The encounter coordinator reuses it inside its own transaction with a fixed lock order (encounter, then characters by ascending id) and a single-use roll. The restore procedure proved receipts survive a restore and still replay.
- **Pinning works.** A character given a homebrew item keeps version 1 after the author publishes version 2 (server test and §6). Drafts are never heads, so they can never be pinned.
- **Authorization in services and SQL.** Every procedure asserts a policy action; ownership, DM membership and private-source visibility are checked in services and SQL predicates, with allow and deny cases in tests.
- **Recovery.** Open live streams are force-closed on shutdown; clients refetch on revision or version gaps and poll while disconnected; the E2E restarts the server twice.

Weaknesses and risks (none is a confirmed data-integrity defect):

| #   | Risk                                                             | Where                                                             | Why it matters before Phase 3                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | Receipt lookup happens before the transaction opens              | `core/commands.ts` line 184, `encounters/service.ts` line 593     | Two truly concurrent sends of one command id never apply twice (the row lock and revision check stop the second), but the second gets `CONFLICT` instead of a replay. Cheap to move inside the transaction now; harder once more aggregates share receipts. |
| R-2 | Monster attacks resolve outside `planAction`                     | `encounters/service.ts` (`MonsterPlan`)                           | Two resolution paths for the same rules (criticals, advantage, defenses). M5.3 is meant to replace this; until then any rule fix must be made twice.                                                                                                        |
| R-3 | `rolls` and `command_receipts` grow without bound                | schema, no prune job                                              | DATA_MODEL promises 7-day receipt retention; nothing implements it. Harmless at alpha scale, a disk and audit concern later.                                                                                                                                |
| R-4 | Spell damage lives in content the converter does not fill        | `tools/srd-import`, `content/srd-5.1/srd-5.1.spells.package.json` | The engine path is ready; the data is empty. Phase 3's spell work must start with the converter, or every spell-casting class stays half-automated.                                                                                                         |
| R-5 | Transitive snapshot loading is capped at 12 rounds               | `characters/snapshot.ts` line 138                                 | Deep homebrew reference chains (class → feature → feature → spell) could silently stop loading; today's content never exceeds 4. Worth a diagnostic rather than a silent cap.                                                                               |
| R-6 | `encounters.get` recomputes every character's sheet on each read | `encounters/service.ts`                                           | Linear in party size per poll; fine for a table of five, a cost once live views and larger parties arrive.                                                                                                                                                  |
| R-7 | The in-process event bus assumes one server process              | `core/events.ts`                                                  | Documented; a second instance would need a shared bus. Not a 1.0 target.                                                                                                                                                                                    |
| R-8 | The DM command allow-list is a constant in the character service | `characters/service.ts`                                           | M4.1's `dm_can_edit_characters` must extend it rather than add a bypass; the extension point exists but is not yet data-driven.                                                                                                                             |
| R-9 | Documentation drift                                              | CLAUDE.md, ARCHITECTURE §9, TEST_STRATEGY §5                      | The CLI form `pnpm -F @scriptorium/server cli -- <command>` failed ("unknown command --"); the backup is CSV table dumps per table, not `pg_dump -Fc` and `uploads.tar` as ARCHITECTURE §9 said. Both corrected after the owner decision (§10).             |

## 4. Automation coverage

### 4.1 Measured (regenerated 2026-10-22, identical to the committed report)

- Alpha set: 195 entries, 97 full, 41 partial, 57 manual, 0 pending; 138 verified, 0 unverified.
- Alpha class and subclass features: 149 rows, 70 full, 24 partial, 55 manual; 94 (63.1%) full or partial.
- Whole SRD: 1,948 entries, 295 full, 41 partial, 63 manual, 1,549 pending.

### 4.2 The 55 manual class and subclass rows, classified

| Class                                       | Count | Rows                                                                                                                                                                                                                                                                        | Assessment                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural placeholders                     |    34 | Martial Archetype, Roguish Archetype, Divine Domain, Otherworldly Patron and their 14 "improvement" rows; Domain Spells 1–5; Action Surge (2 uses), Indomitable (2 and 3 uses), Channel Divinity (2 and 3 per rest), Divine Intervention improvement; Destroy Undead CR ½–4 | Correctly excluded. The scaling rows are honest: the level-2/9 features define the resource with a formula over the class table (`table('indomitable-uses', classLevel(...))`), so the later rows carry nothing. Destroy Undead is Turn Undead's outcome scaling, applied by the table. |
| Narrative or table-adjudicated              |    10 | Protection (a reaction on another creature's attack), Elusive (the attacker's roll), Second-Story Work, Use Magic Device, Book of Ancient Secrets, Eyes of the Rune Keeper, Gaze of Two Minds, Voice of the Chain Master, One with Shadows, Witch Sight                     | Manual is appropriate for the alpha; Protection and Elusive become automatable only inside the tracker (M5.3).                                                                                                                                                                          |
| Mechanical, should be automated, incomplete |    11 | Two-Weapon Fighting, Survivor, Evasion, Reliable Talent, Thief's Reflexes, Disciple of Life, Blessed Healer, Supreme Healing, Dark One's Blessing, Eldritch Spear, Repelling Blast                                                                                          | Each has a measurable effect and no effect type yet: off-hand attacks; turn-start regeneration; save-outcome riders; roll floors (the dice grammar already supports `min`); healing bonuses and side effects; kill-trigger temp HP; range changes; forced movement.                     |

With the 10 narrative rows treated as explicit waivers, the gate measures 94 of 105 rows: 89.5%. Automating the 11 mechanical rows would take it to 100% of the non-placeholder set. There is no classification that reaches 95% honestly; the gate requires engine and content work.

### 4.3 Conflicts with "every numeric or resource-bearing feature is `full`"

| Feature                              | Level today | Numeric or resource part left to hand                                                                    |
| ------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------- |
| Two-Weapon Fighting (fighting style) | manual      | ability modifier added to off-hand damage (the 1.0 list names fighting styles' numeric parts explicitly) |
| Disciple of Life                     | manual      | +2 + spell level healing                                                                                 |
| Dark One's Blessing                  | manual      | temporary hit points equal to CHA modifier + warlock level                                               |
| Survivor                             | manual      | 5 + CON modifier hit points at the start of each turn below half                                         |
| Reliable Talent                      | manual      | treat a d20 roll of 9 or lower as 10 on proficient checks                                                |
| Remarkable Athlete                   | partial     | half proficiency on raw STR/DEX/CON checks (listed as a manual part)                                     |

Uncanny Dodge (halving damage from one attack) and Indomitable, Stroke of Luck, Dark One's Own Luck, Hurl Through Hell and Eldritch Master are `partial` with their resource automated and the reaction or reroll by hand; that reading of "resource-bearing" is defensible, but the owner should confirm it.

### 4.4 Recommended metric and decision

Report two numbers permanently: full-or-partial over all class and subclass rows (what the plan says) and over non-placeholder rows with the narrative waivers listed by name (what the engine can honestly be held to). Neither meets 95% today. The options are the owner's:

1. **Waive for A1 with destinations**: accept 81.7% (89.5% after waivers) now; make the 11 mechanical rows and the §4.3 conflicts a named deliverable at the start of M3.2 (new effect types `healing.bonus`, `roll.minimum`, `action.offHand`, `turnStart.heal`, `save.outcome` riders, `spell.range` and forced movement flags) and re-measure the gate for all twelve classes at M3.2.
2. **Remediate before Phase 3**: a short milestone (one to two sessions) implementing those effect types on the alpha content only, then re-run the gate. This closes the §4.3 conflicts too.
3. **Hold the gate as written**: A1 fails until option 2 is done.

This review does not change any threshold or classification.

## 5. Test evidence

Commands run on d9d6195 (2026-10-22), output summarised from `scratchpad/a1-verify.log`:

| Command                                  | Result                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                              | clean                                                                                                                                        |
| `pnpm format:check`                      | all files formatted                                                                                                                          |
| `pnpm typecheck`                         | 8 of 8 packages                                                                                                                              |
| `pnpm test`                              | 32 files, 324 passed                                                                                                                         |
| `pnpm coverage:automation`               | 1,948 entries; 336 verified, 0 unverified; alpha 63.1%                                                                                       |
| `pnpm build`                             | server (tsup) and web (vite) built                                                                                                           |
| `pnpm test:e2e`                          | 51 passed, 2 skipped (both intentional desktop-only checks: the first-run flow in `auth.spec.ts` and the Ctrl+K shortcut in `shell.spec.ts`) |
| `pnpm exec vitest run tools/conformance` | 2 files, 18 tests (alpha levels 1–20)                                                                                                        |

What the E2E asserts, checked by reading the specs rather than counting:

- Builder and level-up: every alpha class reaches level 5 with a subclass; choices, equipment, damage, reload and undo (`characters.spec.ts`).
- Sheet: temp HP, resources, coins, conditions, exhaustion, inspiration, overrides with the engine value kept, an attack rolled and applied, a check rolled, a manual snapshot, all surviving a reload; a short rest with a server-rolled die; undo refused after a rest with the reason shown (`sheet.spec.ts`).
- Homebrew: the sword's +8 preview against a fiend, Bless for one charge, publish, give, attune, plan against a fiend (`homebrew.spec.ts`).
- Acceptance: the full chain of §2 including the restart and the replayed attack, with the attack result checked for consistency (hit changes monster HP, miss does not) rather than for a fixed roll.

Gaps in the tests (not failures):

- No authorization meta-test enumerates every procedure for allow and deny cases (TEST_STRATEGY §5 asks for one); the policy matrix covers actions, the module tests cover the main deny paths.
- Coordinator concurrency is covered by sequential replay and consumed-roll tests, not by concurrent requests.
- The restart and acceptance specs run on desktop only; the player's phone view of the tracker is not exercised.
- No test casts a spell with damage (there is no such content, see D-1) or exercises death saving throws (D-2).
- Attack outcomes depend on real dice; the specs assert consistency, not a specific result, which is correct but means a miss-only run exercises less code.

## 6. Restore acceptance

Procedure: `scratchpad/a1-restore.mjs` (kept outside the repository), built server `apps/server/dist/main.js`, `NODE_ENV=test`.

- Instance A: data directory `.data/a1-restore/a`, embedded PostgreSQL 17 on port 54341, HTTP 3201. Seeded through the public API: administrator, an invited player, a level-2 fighter with a longsword and 3 damage taken, a homebrew source and a weapon published twice (the character given and attuned to version 1 before version 2 was published), a campaign with both users, both characters submitted and approved, the source shared, an encounter with the fighter and two skeletons, initiative rolled, combat started and one attack committed; a file placed in `uploads/` (there is no upload API yet). Backup taken through `admin.backups.create`.
- Instance B: fresh data directory `.data/a1-restore/b`, embedded PostgreSQL on port 54342, HTTP 3202. `verify-backup` then `restore` through the CLI on a copy of the backup, then the server started.

All 27 checks passed, among them: both users sign in with their passwords; `characters.get` returns byte-identical `sheet` and `aggregate` JSON (revision 7) for the fighter and for the player's rogue; event log and snapshots identical; the homebrew entry is head version 2 with no draft and the character still computes the version-1 bonus (+7); campaign members, approvals and shared sources identical; encounter status, round, participants, hit points, conditions and log identical; content counts and licences identical; the shared source visible to the player; the uploaded file restored with the same sha256; the pre-backup attack command re-sent on B replays its receipt; a new command on the restored character succeeds.

Not preserved or not verifiable today: nothing in the data was lost. Two notes: the backup format is per-table CSV dumps plus a copy of the uploads directory, not the `pg_dump` archive the design text describes (R-9); and uploads cannot be created through the application yet, so that part of the check used a file written to disk.

## 7. Defect and technical-debt register

Severity: high = blocks the acceptance scenario or corrupts data; medium = wrong or missing behaviour a player meets in normal play; low = quality or documentation.

| Id   | Severity | Finding                                                                                                                                                           | Reproduction or evidence                                                                                                                            | Recommended destination                                                                                        |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| D-1  | medium   | Spell action cards never deal damage: all 327 SRD spells have an empty `damage` block, although `actions/plan.ts` reads `damage.bySlotLevel` / `byCharacterLevel` | `node -e` over `srd-5.1.spells.package.json`: 0 spells with usable dice; cast Guiding Bolt on a cleric's sheet: plan has the attack roll, no packet | Phase 3 priority: first deliverable of M3.2 (converter extracts damage, healing already present for 10 spells) |
| D-2  | medium   | No death saving throws: `state.deathSaves` exists and resets on a long rest only; no command, no control, no dying state                                          | Apply 50 damage on any sheet: `0 / 11`, nothing else                                                                                                | Phase 3 priority (sheet work alongside M3.2, before M5.3)                                                      |
| D-3  | medium   | Encounter log payloads reach players unfiltered: `targetHp` and `damageTaken` reveal monster hit points that the participant list hides                           | `encounters.get` as a player after an attack: `events[0].payload.targetHp` is present                                                               | Fix before Phase 3 (small: strip payload fields for the player role in `encounters/service.ts` `get`)          |
| D-4  | medium   | Item-granted spells cannot be cast from an action card; the planner only knows class spellcasting sources                                                         | Sheet lists "Bless · granted by …" with no Cast button (deliberate, ADR-0036)                                                                       | Phase 3 priority with D-1 (M3.2 spells)                                                                        |
| D-5  | medium   | Builder does not enforce starting equipment or spell-selection limits; the engine reports limits as diagnostics only                                              | Known since M2.5                                                                                                                                    | Phase 3 (M3.1/M3.2 builder polish)                                                                             |
| D-6  | low      | CLI documentation wrong for pnpm 12: `pnpm -F @scriptorium/server cli -- <command>` passes `--` to the CLI ("unknown command --")                                 | Run it                                                                                                                                              | Fix before Phase 3 (CLAUDE.md, DEPLOYMENT.md)                                                                  |
| D-7  | low      | Backup described as `pg_dump -Fc` + `uploads.tar` in ARCHITECTURE §9 and TEST_STRATEGY §5; implementation is CSV per table + uploads directory                    | `.data/a1-restore/a/backups/<name>/` contains `db/`, `manifest.json`, `uploads/`                                                                    | Fix before Phase 3 (docs)                                                                                      |
| D-8  | low      | `canUndo`'s window check can never trigger (the latest event is always within the first 20)                                                                       | `packages/rules-engine/src/commands/undo.ts`                                                                                                        | Phase 3 cleanup; the documented limit still holds because only the latest event is offered                     |
| D-9  | low      | Receipt lookup outside the transaction (R-1)                                                                                                                      | code                                                                                                                                                | Phase 3 cleanup                                                                                                |
| D-10 | low      | No retention for `rolls` and `command_receipts` (R-3)                                                                                                             | schema                                                                                                                                              | M6.3 hardening                                                                                                 |
| D-11 | low      | No authorization meta-test (TEST_STRATEGY §5)                                                                                                                     | tests                                                                                                                                               | M4.1 (roles and matrix)                                                                                        |
| D-12 | deferred | Players cannot act in the tracker; the DM resolves every attack                                                                                                   | ADR-0037                                                                                                                                            | M5.3                                                                                                           |
| D-13 | deferred | Monster actions outside `planAction`; no concentration prompts, legendary actions, recharge, hidden combatants                                                    | ADR-0037                                                                                                                                            | M5.3                                                                                                           |
| D-14 | deferred | Spell self-effects on cast (buffs, conditions)                                                                                                                    | ADR-0033                                                                                                                                            | post-1.0 per the plan, or M3.2 if the owner prioritises it                                                     |
| D-15 | deferred | Eleven mechanical class features manual (§4.2) and six numeric conflicts (§4.3)                                                                                   | coverage report                                                                                                                                     | Owner decision (§4.4)                                                                                          |
| D-16 | low      | Tracker shows no hit points for character participants; the DM opens the sheet                                                                                    | UI                                                                                                                                                  | M5.3 or earlier polish                                                                                         |

## 8. Owner acceptance checklist

Perform these in the running application (not in tests) before signing off:

1. Install from a clean data directory, complete setup, create an invite and register a second user in a private window.
2. As the player: build a cleric, pick skills and a domain at level 1, prepare spells, add armor and a weapon, level up to 3, choose the subclass, and open "Why?" on AC and hit points to read the breakdowns.
3. As the player: take damage to 0 and note that no death-save control exists (D-2); heal; take a short rest spending a hit die; undo a damage event; restore a level-up snapshot.
4. As the DM: author the specification's sword in the homebrew editor (bonuses, 1d8 radiant against fiends and undead, three charges, a granted spell, attunement), preview it on a character against a fiend, publish, share the source with the campaign, and give it to the player's character from the DM's view of the sheet.
5. As the player: attune the sword, open its action card, set the target type to fiend, roll and apply; confirm the radiant packet and the event log entry; confirm the granted spell is listed but not castable (D-4).
6. As the DM: create an encounter, add the party and two skeletons, roll initiative, start, resolve one character attack and one skeleton attack, apply a condition to each, advance turns; restart the container and confirm the encounter and the sheet are unchanged.
7. As the player on a phone: open the encounter and confirm monster hit points are absent from the list; be aware the log still reveals them until D-3 is fixed.
8. Run a backup from the admin page and verify it from the CLI with `pnpm -F @scriptorium/server cli verify-backup <dir>` (no `--`).
9. Decide §4.4.

## 9. Gate recommendation

**CONDITIONAL PASS.**

Established: the architecture does what the plan says it does, the acceptance scenario runs end to end with a restart and a replayed command, and a restored instance is indistinguishable from the original for every object the alpha creates. No confirmed data-integrity, authorization or determinism defect was found.

Conditions: (1) the owner decides the coverage gate per §4.4, since the written threshold is not met and cannot be met without engine work; (2) D-3 (log leak), D-6 and D-7 (documentation drift) are fixed before Phase 3 begins; (3) D-1, D-2 and D-4 are scheduled explicitly in Phase 3 (M3.2's first deliverables) rather than carried as unlisted debt.

If the owner holds the 95% gate as written, the honest status is FAIL, remediable by the short milestone described in §4.4 option 2.

## Usage

Owner's checkpoint before A1: $229.99 cumulative extra usage. After this audit the account tool reports $238.22 cumulative (account-level, may include other sessions); the session context stood at 859,128 tokens (86% of 1M) when the report was written. No per-milestone billing is exposed or estimated.

## 10. Owner decision and follow-up (2026-10-22)

The owner approved §9 option 1: a conditional Alpha Gate pass with an explicit, limited coverage exception (ADR-0038). The original metrics are recorded unchanged (63.1% / 81.7% / 89.5%); the 34 placeholder rows are non-mechanical for future reporting; the 10 narrative rows are named exceptions; the ≥ 95% target over eligible mechanical features is preserved with numeric or resource-bearing mechanics required to be `full`; the 11 mechanical features and the six numeric conflicts are a mandatory workstream at the start of M3.2; D-1, D-2 and D-4 are early M3.2 deliverables. This exception is not compliance with the original threshold.

Corrections delivered before Phase 3, narrowly scoped:

| Id  | Change                                                                                                                                                                                                                                                                 | Evidence                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-3 | `encounters.get` now strips `targetHp`, `hpCurrent`, `hpMax` and `hpTemp` from event payloads for the player role; DM notes and attack options were already DM-only, participant hit points and AC already hidden. The live stream carries only the encounter version. | `apps/server/src/modules/encounters/service.ts` (`serializeEvent`); `apps/server/test/encounters.test.ts` asserts no DM-only key in any player-visible payload or top-level field, that the DM still receives them, and that both roles get the same participant shape. |
| D-6 | CLI documented as `pnpm -F @scriptorium/server cli <command>` (pnpm 12 passes arguments through; `--` reached the CLI as a command).                                                                                                                                   | `CLAUDE.md`, `docs/CONTENT_FORMAT.md`.                                                                                                                                                                                                                                  |
| D-7 | ARCHITECTURE §9 now describes the implemented backup (manifest, per-table CSV from one snapshot, uploads copy; restore verifies, migrates, truncates, `COPY FROM`, swaps uploads); the unused `PG_BIN_DIR` row was removed from the deployment table.                  | `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`.                                                                                                                                                                                                                           |

A1 remains **not verified**: owner acceptance testing (§8) is outstanding, and Phase 3 has not been started.

Follow-up (2026-10-22, later): owner acceptance testing on Unraid passed the §8 checklist after the issue #2 hotfix (48fbe40). The nineteen findings it produced are reconciled in `docs/A1_RECONCILIATION.md`; the owner approved the bounded A1-R milestone (ADR-0039: issues #3, #5, #13, #19, #8), delivered with tests and `docs/A1R_RETEST.md`. A1 remains conditional pass, owner testing passed, remediation pending the owner's retest of those five items; the coverage exception of ADR-0038 is unchanged.
