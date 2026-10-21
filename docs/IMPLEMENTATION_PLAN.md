# Implementation Plan

Milestone-driven delivery. Work one milestone at a time in dependency order; keep the application runnable at every commit. Each milestone closes with a report (template in §4) and its row below is updated with status, evidence and measured usage.

Sizes: S ≤ 1 session, M 1–2, L 2–4, XL 4+ (a session is one focused Claude Code working session). Status: `not started`, `in progress`, `done` (criteria met, tests green), `verified` (owner confirmed in the running app).

## 1. Status table

| Id | Milestone | Size | Depends on | Status | Evidence | Measured usage |
|---|---|---|---|---|---|---|
| M0.1 | Docs and CLAUDE.md, git init | S | — | done | 2026-10-21: repo initialised on `main`; 8 docs (880 lines) written from the approved plan; first commit | context 224k tokens at close; billed tokens/cost not exposed (see §5) |
| M1.1 | Monorepo and tooling | S | M0.1 | not started | | |
| M1.2 | Integration spikes S1–S5 | M | M1.1 | not started | | |
| M1.3 | Database, auth, users | M | M1.2 | not started | | |
| M1.4 | App shell and design system | M | M1.1 | not started | | |
| M1.5 | Content schema, rulesets, sources, SRD import | L | M1.3 | not started | | |
| M1.6 | Production deployment and backup | M | M1.3 | not started | | |
| M2.1 | Dice (`ast` + `roll`) | S | — | not started | | |
| M2.2 | Static engine core | L | M1.5 | not started | | |
| M2.3 | Action resolution and spellcasting | L | M2.2, M2.1 | not started | | |
| M2.4 | Alpha content pack | L | M2.3 | not started | | |
| M2.5 | Persistence, commands and builder | L | M2.4, M1.4 | not started | | |
| M2.6 | Interactive sheet | L | M2.5 | not started | | |
| M2.7 | Homebrew thin slice: magic item editor | M | M2.6 | not started | | |
| M2.8 | Campaign and encounter thin slice | M | M2.7 | not started | | |
| A1 | Alpha gate | S | M2.8 | not started | | |
| M3.1 | Compendium | M | M1.5, M1.4 | not started | | |
| M3.2 | Full SRD mechanics (3 deliverables) | XL | A1 | not started | | |
| M3.3 | Homebrew editors (class/subclass last) | XL | M2.7, M3.1 | not started | | |
| M3.4 | Compatibility and transfer | M | M3.3 | not started | | |
| M4.1 | Roles, membership, DM tools | M | M2.8 | not started | | |
| M4.2 | Campaign content and play tools | M | M4.1, M3.1 | not started | | |
| M5.1 | Monster management | M | M3.3 | not started | | |
| M5.2 | Encounter builder and difficulty | S | M5.1 | not started | | |
| M5.3 | Combat tracker complete | L | M5.2 | not started | | |
| M6.1 | Export and API polish | M | M5.3 | not started | | |
| M6.2 | UX, accessibility, performance | M | M5.3 | not started | | |
| M6.3 | Hardening and release 1.0 | M | M6.1, M6.2 | not started | | |

## 2. Milestone definitions and completion criteria

### Phase 0
- **M0.1 Docs and CLAUDE.md.** `git init`; write `PRODUCT_SPEC`, `ARCHITECTURE`, `DATA_MODEL`, `RULES_ENGINE`, `IMPLEMENTATION_PLAN`, `DECISIONS`, `TEST_STRATEGY`, `CLAUDE.md`. *Done:* files exist and reflect the approved plan (Revision 2 + clarifications); first commit.

### Phase 1 — Foundation
- **M1.1 Monorepo and tooling.** pnpm, Turborepo, TS strict, ESLint (+boundaries, jsx-a11y), Prettier, Vitest, Playwright scaffold, CI workflow file. *Done:* `pnpm dev` serves web and server; `pnpm lint typecheck test` pass; `/healthz` responds; a deliberate boundary violation fixture fails lint.
- **M1.2 Integration spikes.** S1 dev database, S2 API stack, S3 auth, S4 PG17 parity, S5 native modules (see `ARCHITECTURE.md` §10). Time-boxed to two sessions. *Done:* each spike has a go/no-go ADR with the command output that proves it; auth approach and dev database are fixed.
- **M1.3 Database, auth, users.** Identity schema, migration runner with advisory lock, dev database per S1, setup wizard, login/logout, sessions, invites, rate limits, audit log, admin user management. *Done:* fresh start → wizard → admin → invite → second user; ≥ 15 auth integration cases; restart keeps sessions.
- **M1.4 App shell and design system.** Tokens, bundled fonts, light/dark, reduced motion, layout, navigation, base components, empty/loading/error patterns, command palette shell. *Done:* renders at 375/768/1280 px; axe clean; theme persists.
- **M1.5 Content schema, rulesets, sources, SRD import.** `content-schema` (kinds, static and action effects, scoped predicates, choices, automation metadata, stat paths); `srd5.1-2014` ruleset config; content tables and projections; `tools/srd-import` producing packages for spells, equipment, magic items, monsters, conditions and rules, plus prose-and-structure skeletons for classes, subclasses, species, backgrounds and feats; idempotent `import-content`. *Done:* imported counts recorded and matching the SRD; re-import is a no-op; licence page shows attribution; a fixture set of invalid effects (unknown type, scope violation, bad variable, unknown hook) is rejected.
- **M1.6 Production deployment and backup.** Dockerfile, compose, Unraid template, env validation, `/readyz`, backup/verify/restore CLI, `DEPLOYMENT.md`. *Done:* clean install from the docs on a Docker host (CI or Unraid); restart-safe; restore acceptance test passes against a restored second instance.

### Phase 2 — Engine and playable alpha
- **M2.1 Dice.** `dice/ast` and `dice/roll`, advantage/disadvantage, crits, keep/drop, rerolls, explainable results, validation. *Done:* unit + property tests; malformed expressions rejected; lint blocks `dice/roll` in the engine.
- **M2.2 Static engine core.** Contribution model, demand-driven resolver, cycle detection, diagnostics, stat paths, grants walk, pending choices, overrides, action templates; abilities through defenses. *Done:* ≥ 60 golden assertions (AC formula groups, stack keys, clamps, replaceFinal, a cycle fixture producing deterministic `CYCLE_DETECTED`, override with restore).
- **M2.3 Action resolution and spellcasting.** `planAction`/`applyRolls`/`applyPackets`, action-scoped effects, tri-state predicates and questions, turn bookkeeping with 2014 resets, packet defenses; spell progressions incl. multiclass and pact slots, known/prepared limits, DC/attack, granted spells. *Done:* golden action plans (Sneak Attack once per turn incl. on a reaction, GWF reroll, target-typed rider, skeleton vulnerability, Fighter 5/Warlock 3 and Rogue 3/Cleric 2 slots); turn reset tests.
- **M2.4 Alpha content pack.** Mechanics overlays with behavioural cases for Fighter (Champion), Rogue (Thief), Cleric (Life), Warlock (Fiend) L1–20; Hill Dwarf, High Elf, Human; Acolyte; Grappler; SRD armor table, ~15 weapons, 6 magic items (+1 weapon, Ring of Protection, Headband of Intellect, a charged wand, an attunement item with target-typed damage, Gauntlets of Ogre Power); all SRD spells from M1.5 with cleric and warlock list membership verified at levels 0–9; 12 monsters with structured actions and defenses. *Done:* alpha conformance thresholds (`TEST_STRATEGY.md` §4) with 100% verified; golden sheets at L1/5/11/13/15/17/20 per class exercising high slots, preparation counts and Mystic Arcanum, and both multiclass builds; `AUTOMATION_COVERAGE.md` generated. Spell self-effect mechanics are out of scope.
- **M2.5 Persistence, commands and builder.** Character tables, `core/commands`, receipts, snapshot loader, all commands, builder stepper driven by `pendingChoices`, ability methods, equipment and spells, HP fixed/rolled/manual, review, level-up and multiclass wizard. *Done:* E2E creates each alpha class at L1 and levels to 5; multiclass prerequisites enforced; 409 on stale revision; same `commandId` applies once; every command appends an event with before/after.
- **M2.6 Interactive sheet.** All sections; action cards with plan/roll/commit; damage/heal/temp HP; slots; resources; rests; equip/attune; currency; conditions/exhaustion; toggles; overrides; undo with limits; snapshots; diagnostics panel; print stylesheet; mobile layout. *Done:* every control persists and survives restart (E2E); undo limits enforced (tests); mobile E2E passes; no dead controls.
- **M2.7 Homebrew thin slice: magic item editor.** Sources, draft/publish, item editor with Effect Builder for static bonuses, charges, granted spells and action-scoped target-typed damage; preview on the user's character. *Done:* the specification's sword example is created through the form, assigned, and appears on the sheet and in action plans.
- **M2.8 Campaign and encounter thin slice.** Create campaign, invite link, join, submit and approve character, share a homebrew source; encounter with party and alpha monsters, initiative, rounds and turns issuing `turnStarted`, attacks through the encounter action coordinator with receipts and single-use rolls, HP via packets with defenses, conditions, persistence. *Done:* acceptance scenario E2E on alpha content including a server restart mid-encounter and a retried attack command that applies once.
- **A1 Alpha gate.** Architecture review of engine and command APIs; restore acceptance re-run with a character; record decisions, coverage and usage. Breaking changes are cheapest here; afterwards the controlled change process applies. *Done:* owner sign-off to begin content breadth.

### Phase 3 — Content breadth, compendium, homebrew
- **M3.1 Compendium.** Faceted browse, search, detail pages, source enable/disable. *Done:* search and facets E2E; disabled sources vanish from builder options.
- **M3.2 Full SRD mechanics.** Three deliverables: Barbarian/Monk/Paladin/Ranger; Bard/Druid/Sorcerer/Wizard; remaining species, all magic items, remaining monsters. *Done:* 1.0 conformance thresholds met and reported; golden sheets per class at L1/5/11/20.
- **M3.3 Homebrew editors.** Ordered: weapon/armor/item → feat → spell → species → background → condition/feature/resource → monster/NPC → class/subclass. Advanced Editor, preview, duplicate, version history, attribution. *Done:* each editor has an E2E create → publish → use test; automation levels recorded on homebrew features.
- **M3.4 Compatibility and transfer.** Update prompts with diffs, impact analysis, frozen versions, content and character package import/export with conflicts. *Done:* content stability tests; round trips.

### Phase 4 — Campaigns complete
- **M4.1 Roles, membership, DM tools.** Policy hardening, co-DM/observer, approvals, DM sheet view/adjust, authorization matrix. *Done:* matrix covers every procedure.
- **M4.2 Campaign content and play tools.** Per-campaign sources and shares, notes with visibility, NPCs, awards through character commands, roll log with private rolls, SSE. *Done:* player cannot fetch DM notes or hidden data (tests).

### Phase 5 — Encounters complete
- **M5.1 Monster management.** Custom monsters, variants, NPC stat blocks.
- **M5.2 Encounter builder.** 2014 difficulty with multipliers and party size, adjustments, notes. *Done:* matches SRD worked examples.
- **M5.3 Combat tracker complete.** Concentration prompts, monster actions through `planAction`, legendary/recharge, hidden combatants, log, player view via SSE. *Done:* full acceptance scenario on full content; restart-safe.

### Phase 6 — Polish and production readiness
- **M6.1 Export and API polish.** Campaign export/import, OpenAPI docs, PDF decision, full-instance export.
- **M6.2 UX, accessibility, performance.**
- **M6.3 Hardening and release.** CSP, uploads, rate limits, dependency audit, restore acceptance from a backup taken by the previous released version, docs, `v1.0.0`.

## 3. Acceptance scenario coverage

install (M1.6) → account (M1.3) → campaign + invite (M2.8/M4.1) → SRD available (M1.5) → player builds a L1 2014 character (M2.5) → rolls, HP, sheet (M2.6) → level up (M2.5) → DM homebrew item with modifier and charges (M2.7) → assigned and reflected (M2.8) → encounter with initiative and HP (M2.8/M5.3) → restarts (M1.6 and persistence tests throughout). Proven at Gate A1 on alpha content and at 1.0 on full content.

## 4. Milestone report template

```
## <Id> <Milestone> — <date>
Shipped: ...
Verification: <command> → <result summary> (counts of tests, golden cases, coverage %)
Skipped / unsupported: ...
Decisions: ADR-xxxx ...
Measured usage: <tokens / cost from the session usage tooling, or "not exposed">
```

## 5. Usage log

What the session usage tooling exposes: the session's current context-window size, the account's plan-window percentages, and the account's cumulative extra-usage spend. It does not expose per-milestone billed tokens or cost, so those columns stay "not exposed" unless the tooling changes. The account-level numbers are cumulative across all sessions and are recorded only as a reference point, never attributed to a milestone.

| Milestone | Date | Session context at close | Billed tokens | Cost | Account reference | Source |
|---|---|---|---|---|---|---|
| M0.1 | 2026-10-21 | 224,280 tokens (22% of 1M) | not exposed | not exposed | weekly window 29% used; extra usage spent to date $11.87 (cumulative, all sessions) | `get_usage` |
