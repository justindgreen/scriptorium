# Decisions

Architecture Decision Records. Append new entries; do not rewrite accepted ones (supersede them with a new entry). Format: context, decision, consequences.

## ADR-0001 Modular monolith in TypeScript
Context: a self-hosted app for one DM and a handful of players; the owner asked to avoid unnecessary infrastructure.
Decision: one server process, one SPA, one database; pnpm workspaces with a pure rules-engine package shared by server and browser.
Consequences: simple deployment on Unraid; game math exists once; boundaries are enforced by lint rather than by network.

## ADR-0002 Vite SPA + Fastify instead of Next.js
Context: an authenticated, highly interactive app gains little from SSR; the owner approved the SPA option.
Decision: React 19 + Vite SPA served as static files by a Fastify 5 server in the same container.
Consequences: no server components or SSR build complexity; print/PDF handled by print CSS first.

## ADR-0003 tRPC v11 with an OpenAPI subset
Context: ~150 app procedures benefit from end-to-end types; the import/export API must be documented for external tooling.
Decision: tRPC for the app API; `trpc-to-openapi` publishes the transfer and health procedures as versioned REST with OpenAPI. Verified by spike S2; fallback is hand-written Fastify routes with Zod and `@fastify/swagger` for that small surface.
Consequences: one implementation, two faces.

## ADR-0004 PostgreSQL 17 with Drizzle; SQLite rejected
Context: the owner prefers Postgres; Unraid has Postgres templates; we need tsvector, trigram, jsonb and CTEs.
Decision: PostgreSQL 17 (16 tolerated with a warning), Drizzle ORM with committed SQL migrations. No dual-database support.
Consequences: an extra container on Unraid; reviewable SQL migrations; advanced search features available.

## ADR-0005 Authentication decided by spike S3; default Better Auth
Context: Revision 1 proposed a hand-rolled implementation; the owner asked for that decision to be reviewed.
Decision: adopt Better Auth if spike S3 confirms offline username/password without email, Drizzle adapter on our schema, DB-backed cookie sessions, admin/role plugin, rate limiting, invite-gated sign-up and acceptable dependency footprint; otherwise implement our own (Argon2id, opaque DB sessions, invites) following the Lucia guide patterns. The policy module is independent of this choice.
Consequences: less bespoke security code if adopted, with some upgrade churn; the spike records the evidence.

## ADR-0006 Server-Sent Events for live updates
Context: live combat tracker and roll log; reverse proxies on Unraid.
Decision: SSE via tRPC subscriptions, emitted post-commit only; fallback dedicated SSE route; polling as last resort.
Consequences: no WebSocket infrastructure; proxy buffering must be documented.

## ADR-0007 Two engine layers: static sheet and contextual action resolution
Context: Sneak Attack, target-typed damage, conditional resistances and once-per-turn limits do not belong in a static sheet.
Decision: `computeSheet` for context-free statistics and action templates; `planAction` → explicit roll → `applyRolls`/`applyPackets` for anything depending on attack, target, turn or situation. Effects and predicate leaves are scoped static or action; tri-state predicates turn unknown facts into questions with stored defaults.
Consequences: a plan → roll → commit flow with a one-click default path; more API surface; correct modelling of contextual mechanics.

## ADR-0008 Contribution model with phases, priorities, stack keys, formula groups, demand-driven evaluation and cycle detection
Context: a fixed set/add/multiply sequence cannot express replacements, minimums, maximums, exclusive formulas and dependencies deterministically.
Decision: typed contributions (`base, replace, add, multiply, atLeast, atMost, replaceFinal, override, union, remove, formula`) resolved per stat in phase order; demand-driven memoised evaluation with a visiting stack; cycles reported as `CYCLE_DETECTED` with offending effects excluded and the value marked in error; canonical ordering independent of storage order.
Consequences: authors pick an operation, not a phase, with advanced overrides available; every value explainable; deterministic errors.

## ADR-0009 One character aggregate, one revision, commands only
Context: Revision 1 placed equip/attune on inventory rows while mutating them through a runtime-state engine.
Decision: the character is one aggregate (definition + inventory + state) with `characters.revision`; all writes are commands run by `core/commands` in one transaction producing an engine patch, an event with before/after, a revision bump, a receipt and a post-commit SSE event.
Consequences: more 409s if two people edit one character at once (acceptable); a single consistency point; a complete event log.

## ADR-0010 Undo by compensating commands; snapshots for the rest
Decision: undo applies the compensating command for the latest reversible event using recorded `before` values; rests, level-ups, definition edits, imports, content-update acceptance and snapshot restores are not undoable and are covered by snapshots. Undo is limited to the latest event, with no non-reversible event after it, within the last 20 events.
Consequences: exact undo for play-time actions; coarse restore points for structural changes; extra storage bounded by retention.

## ADR-0011 Immutable content versions pinned by characters
Decision: `content_versions` are immutable; characters pin version ids; updates are opt-in with diffs; deleted content remains readable to characters that reference it; impact analysis uses `character_content_refs`.
Consequences: editing or removing shared homebrew never breaks or silently changes a character.

## ADR-0012 Playable alpha on hard content before SRD breadth
Context: the owner asked not to author twelve classes to level 20 before the builder and sheet are exercised.
Decision: alpha content is Fighter (Champion), Rogue (Thief), Cleric (Life), Warlock (Fiend) at levels 1–20, two multiclass builds, Hill Dwarf, High Elf, Human, Acolyte, Grappler, curated items, all SRD spells as metadata with verified cleric and warlock lists through 9th level, and 12 monsters. Gate A1 proves the acceptance scenario on this set. Full SRD coverage remains the 1.0 goal.
Consequences: engine API validated early; thin campaign/encounter slices get completed later.

## ADR-0013 Automation levels with behavioural conformance
Decision: every feature declares `full`, `partial` (with manual parts) or `manual`; every `full`/`partial` feature carries behavioural cases executed through the real engine; a feature is verified only when they pass; coverage is generated to `docs/AUTOMATION_COVERAGE.md`; gates have numeric thresholds.
Consequences: a manual placeholder never counts as a working mechanic.

## ADR-0014 Dice split into `ast` and `roll`
Decision: `@scriptorium/dice/ast` (parse, validate, format, expected value) has no RNG; `@scriptorium/dice/roll` takes an injectable RNG. The rules engine may import only `ast`.
Consequences: "no randomness during sheet computation" is enforced by package structure and lint.

## ADR-0015 Development database without Docker
Context: the development workstation has Node and git but no Docker.
Decision: default to embedded PostgreSQL 17 for dev and tests, verified by spike S1; fallbacks in order: PGlite, native PostgreSQL service, Docker Desktop. Production uses `postgres:17`.
Consequences: daily work needs no Docker; the production image is validated in CI or on Unraid.

## ADR-0016 Backup as one unit covering database and uploads
Decision: a backup directory contains a manifest with checksums, a `pg_dump` custom-format dump and an uploads archive captured after the dump; uploads are immutable and content-addressed with delayed orphan cleanup; restore runs in maintenance mode and is verified; acceptance is tested against a restored second instance.
Consequences: consistent restores; verifiable backups.

## ADR-0017 Controlled architectural change after Gate A1
Decision: after the alpha gate, changes to the engine API, content schema or aggregate shape require an ADR, migrations with a migration test from the previous shape, green golden/conformance/E2E suites, and updated docs. Content-schema changes bump the version and ship a migrator for stored versions.
Consequences: evolution without silent breakage.

## ADR-0018 Working name Scriptorium
Decision: packages `@scriptorium/*`, image `scriptorium`, instance name configurable.

## ADR-0019 SRD 5.1 (2014) first, SRD 5.2.1 (2024) in 1.1
Decision: only the 2014 ruleset ships in 1.0; the engine uses ruleset profiles so 2024 content is a second profile and source without touching existing characters.

## ADR-0020 Class and subclass homebrew editors last in Phase 3
Decision: ship the simpler editors first; class/subclass editors are in 1.0 but sequenced last so they can slip to 1.1 if needed.

## ADR-0021 Command receipts and single-use rolls for combat idempotency
Decision: every command carries a client-generated `commandId` stored in `command_receipts` (retries return the stored outcome); rolls are persisted and consumed by exactly one command; combat actions touching attacker, target and encounter run in one transaction with deterministic lock order and post-commit notifications.
Consequences: no duplicate outcomes from retries or double clicks; no partially committed actions.

## ADR-0022 Turn bookkeeping separated by 2014 reset rules
Decision: global turn identity, once-per-turn usage (resets on any creature's turn), reaction (resets on the owner's turn, usable on any turn), and bonus action/action budget (owner's turn only) are tracked separately in `state.combat`; the tracker issues `turnStarted` to all participants.
Consequences: Sneak Attack on a reaction works; outside tracked encounters the bookkeeping is advisory.
