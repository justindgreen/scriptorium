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

## ADR-0023 Toolchain pins found in M1.1 (2026-10-21)

Context: `pnpm add` resolved TypeScript 7.0.2 (the native compiler), ESLint 10, Vite 8, Vitest 5, tsup 9, Playwright 1.64. typescript-eslint 8.72 refuses to load with TypeScript 7.0 ("typescript-eslint does not support TS 7.0"; support is tracked upstream for TS ≥ 7.1). pnpm 12 blocks dependency build scripts unless allowed.
Decision: pin `typescript` to `^6` at the root until typescript-eslint supports TS 7; drop the compiler flags TS 6 made defaults (`esModuleInterop`, `allowSyntheticDefaultImports`, `forceConsistentCasingInFileNames`); allow only `esbuild` to run build scripts via `allowBuilds` in `pnpm-workspace.yaml`; use `defineConfig` from `vitest/config` in Vite configs so the `test` key type-checks. `eslint-plugin-jsx-a11y` 6.10 declares a peer range ending at ESLint 9 but loads and lints under ESLint 10; the warning is accepted until the plugin publishes a compatible range.
Consequences: slower `tsc` than the native compiler; revisit TS 7 when the lint toolchain catches up. Module boundaries are currently enforced with `@typescript-eslint/no-restricted-imports` per directory (proven by `test/boundaries.test.ts`); `eslint-plugin-boundaries` is added when server modules exist (M1.3) to enforce intra-server layering.

## ADR-0024 Integration spike outcomes (M1.2, 2026-10-21)

All spike scripts live in `tools/spikes` and reproduce their evidence with `pnpm --filter @scriptorium/spikes <s1|s2|s3|s5>`.

**S1 Embedded PostgreSQL on the Windows workstation: GO.** `embedded-postgres@17.9.0-beta.17` (the package publishes only prerelease tags, so `@17` ranges do not resolve; pin the exact tag) runs as the normal user `gamed` on win32 x64: initdb 5.4 s, start 175 ms, stop 250 ms; `PostgreSQL 17.9 on x86_64-windows`. pg_trgm, citext, generated tsvector columns with GIN indexes and advisory locks all work. Requires `allowBuilds` for `@embedded-postgres/windows-x64` (plus the linux and darwin variants for CI and other machines) in `pnpm-workspace.yaml`. The newest tag (18.4 beta) was rejected so that the dev database matches the production major. Trigram search found "Fireball" for the typo "firebal" (0.70) while English stemming did not, which supports the planned hybrid search.

**S2 tRPC v11 on Fastify 5 with SSE and OpenAPI: GO.** `@trpc/server@11.19`, `trpc-to-openapi@3.3.3`, zod 4. Query and mutation over HTTP return 200; invalid input returns 400; an async-generator subscription is delivered as Server-Sent Events through the Fastify adapter (`content-type: text/event-stream`, an `event: connected` frame, then data frames); an OpenAPI 3.1 document is generated from `meta.openapi`; the REST route served by `fastifyTRPCOpenApiPlugin` works once the plugin receives its own `createContext`. No fallback needed.

**S3 Better Auth: GO, adopted (closes ADR-0005).** `better-auth@1.7.12` with `drizzleAdapter` on our own tables (`auth_user`, `auth_session`, `auth_account`, `auth_verification`, snake_case columns) and the username and admin plugins. Verified: invite-gated sign-up through a `hooks.before` middleware (the first user is allowed while no users exist; later sign-ups are refused with FORBIDDEN unless the invite code is valid); username sign-in sets `scriptorium.session_token` with HttpOnly, SameSite=Lax and Path=/; sessions are rows in the database and are removed on sign-out; the role is present on the session; a wrong password is UNAUTHORIZED; `createUser` and `listUsers` succeed for an admin and are FORBIDDEN for a player; the HTTP handler returns 429 after 3 attempts per window per IP. Caveats to carry into M1.3: Better Auth requires an email per user, so accounts without one get a synthetic `<username>@scriptorium.local` that is never used for delivery; the default password hash is scrypt (acceptable; Argon2id can be supplied through `emailAndPassword.password.hash` if wanted); sign-up signs the new user in automatically; usernames must be at least 3 characters; the adapter packages and drizzle-orm's peer drivers pull `@prisma/client` and `better-sqlite3` into the lockfile with their build scripts ignored, which M1.3 trims with peer-dependency rules so the server image stays lean. pnpm also reported "Agent skills awaiting approval: @trpc/server"; package-provided agent skills are not approved.

**S4 Production parity on `postgres:17`: PARTIAL.** No GitHub remote exists yet, so CI has not run. The workflow now declares a `postgres:17` service and `DATABASE_URL` for the integration suite that M1.3 adds; the local dev database is the same major (17.9). Closes when the first CI run passes or when the M1.6 install runs the suite on the Unraid host.

**S5 Native modules: GO on Windows, Debian pending.** `sharp@0.35.5` (libvips 8.18.7) creates, resizes and re-encodes to WebP and rejects non-image bytes. The Debian image check happens with the first image build in M1.6. Embedded Postgres binaries are ordinary npm packages cached by the pnpm store, so installs are offline-friendly after the first fetch.

## ADR-0025 Identity implementation details (M1.3, 2026-10-21)

- **Setup is the first sign-up.** `setup.createAdmin` runs under a session-level advisory lock, calls Better Auth's sign-up server-side with `returnHeaders`, forwards the Set-Cookie through the tRPC response, and names the instance. The rule "the first account becomes admin" lives in the user-creation database hook, not in the UI, so it also holds for direct API calls.
- **Invite gating lives in `databaseHooks.user.create.before`.** A use is reserved atomically (`uses < max_uses`, not revoked, not expired) before the user row is written; accounts created through the admin API bypass the invite; a use consumed by a sign-up that fails afterwards is not returned (accepted; an administrator can issue another).
- **Usernames** are 3–32 characters of letters, digits, dot, underscore or dash; Better Auth's default validator rejects dashes, so a custom `usernameValidator` matches our `usernameSchema`.
- **Synthetic emails** `<username>@scriptorium.local` satisfy Better Auth's email requirement; `me.get` returns `null` for them so the UI never shows a fake address, and a real email is optional at registration.
- **Rate limiting** is Better Auth's own (8 sign-ins per minute, 5 sign-ups per 5 minutes, 60 other calls per minute per IP; disabled under `NODE_ENV=test`). The Fastify bridge overwrites `x-forwarded-for` with Fastify's resolved client address, so the limiter keys on the real IP and clients cannot spoof the header; `TRUST_PROXY` controls how Fastify resolves it behind a proxy.
- **Sessions** expire after 14 days and refresh daily; cookie `scriptorium.session_token`, HttpOnly, SameSite=Lax, Secure when `PUBLIC_URL` is https. Deactivating a user (admin plugin ban) revokes their sessions.
- **Databases for development and tests.** Development uses a persistent embedded cluster under `DATA_DIR/pg` on `DEV_PG_PORT` (under turbo the server's cwd is `apps/server`, so it lands in `apps/server/.data/pg`). Vitest starts one throwaway cluster per run and creates one migrated database per test file. Playwright starts the built server on a fresh `.data/e2e` wiped by `e2e/start-server.mjs` (the Playwright config is re-evaluated inside workers, so the wipe cannot live there). A cluster orphaned by a force-killed process is reclaimed by pid before the next start.
- **Web client.** TanStack Router with `beforeLoad` guards (setup pending → `/setup`; no session → `/login`; non-admin → `/`), tRPC through the TanStack Query options proxy, Better Auth's browser client for sign-in, sign-up and sign-out. After any auth change the session query is `reset` (not removed) so mounted observers such as the layout refetch immediately. The web typecheck includes Node types because `AppRouter` is imported as a type from the server package; switch to declaration emit if typecheck time grows.

## ADR-0026 Design system foundations (M1.4, 2026-10-21)

Decision: components are generated into the repository with the shadcn CLI (style `new-york`, Radix primitives through the `radix-ui` package, Lucide icons) and edited in place; tokens are oklch CSS variables mapped into Tailwind v4 with `@theme inline`; Fraunces (display) and Inter (text) are bundled from `@fontsource-variable` so the application never calls a font CDN; the theme preference (`light | dark | system`) lives in `localStorage` and is applied by an inline script before first paint, with the OS preference followed when set to system; `prefers-reduced-motion` collapses animations globally. Navigation destinations come from one list shared by the sidebar, the drawer and the command palette, and only destinations that exist are listed.
Caveats: the CLI could not resolve the `@` alias and emitted `import { cn } from "cn"` (and installed an unrelated `cn` package) and a `next-themes` dependency in the toaster; both were removed and the imports corrected, and `docs/DESIGN_SYSTEM.md` records the fix for future additions. The inline theme script must be allowed by the content security policy with a hash when CSP lands in Phase 6.
Consequences: the application owns its look; new UI milestones add tokens (for example damage types and conditions) rather than ad-hoc colours; three viewports (375, 768, 1280) and axe scans are part of the end-to-end suite from here on.

## ADR-0027 Content pipeline decisions (M1.5, 2026-10-21)

- **Upstream dataset.** SRD 5.1 structured data is converted from the 5e-bits/5e-database repository (`src/2014/en/*.json`, MIT; the SRD text is CC-BY-4.0). The converter refuses to run unless the downloaded LICENSE is the expected MIT licence, treats the files as data (JSON only), and the generated packages are committed so installs are offline. The upstream dataset has no class description prose; class entries carry a minimal description and the text lives on features.
- **`pending` automation level.** Imported class, subclass, species, feature, feat, background, condition and magic-item entries whose mechanics are not authored yet are marked `automation: pending`, which counts as unverified in coverage. Weapons, armor and shields are `full` because their structured data (and the shield's +2 AC effect) is consumed directly by the engine.
- **Versioning on import.** Entries are matched by uid; a sha256 over the mechanical and descriptive payload (sorted keys) decides between unchanged, new version (head moves) and new entry. Versions are never edited.
- **Search.** `content_entries.search_text` (name, tags, description excerpt) with a GIN `to_tsvector('english')` expression index plus a trigram index on `name` (`pg_trgm`, created by migration 0001). Ranking combines ts_rank and name similarity so typos still find entries.
- **Head pointers without foreign keys.** `content_entries.head_version_id` and `draft_version_id` point into `content_versions` without a constraint to avoid a circular dependency; the import and (later) publish services are the only writers.
- **Deferred tables.** `content_source_access` and `content_entry_shares` arrive with campaigns (M2.8), when the rows they reference exist. Visibility today: enabled global sources are readable by every signed-in user; administrators manage sources.
- **Seeding at start.** The server imports bundled rulesets and packages before listening (`SEED_CONTENT`, `CONTENT_DIR`); unchanged content costs one query per source, so restarts stay fast.

## ADR-0028 Logical backups with COPY instead of pg_dump (M1.6, 2026-10-21)

Context: the plan specified `pg_dump` custom-format dumps. The embedded PostgreSQL used for development and tests ships only `initdb`, `pg_ctl` and `postgres`, so `pg_dump` is unavailable on the workstation, and shipping it in the image would require the PGDG client packages.
Decision: backups export every application table with PostgreSQL `COPY ... TO STDOUT (FORMAT csv, HEADER)` from one repeatable-read snapshot into `db/<table>.csv`, record per-table columns, row counts and sha256 in `manifest.json`, and copy uploaded files into `uploads/`. Restore verifies the backup, writes the maintenance marker (a file in DATA_DIR polled by the server once a second, so a CLI restore pauses a running server), brings the schema to the running version with our migrations, truncates the application tables and loads the CSV files in foreign-key order inside one transaction, swaps the uploads directory atomically and re-verifies. Schema authority stays with migrations; a backup restores into the same or a newer application version, never an older one. Scheduling is in-process (`croner`, `BACKUP_CRON`) with retention pruning; restore stays a CLI operation in 1.0.
Consequences: one code path in dev, tests, CI and the image; no external binaries; smaller image. Tradeoffs: not a byte-level physical backup (large binary tables would be slower than pg_dump), and operators who prefer `pg_dump` can still run it against the database container. The Docker image build itself is validated by the CI image job and the first Unraid install, not on the development workstation.

## ADR-0029 Image verification and slimming (2026-10-22)

Context: Docker Desktop was installed on the workstation and the repository was pushed to GitHub (`justindgreen/scriptorium`), so the image could finally be built and exercised. The first CI run (verify job, Ubuntu with a `postgres:17` service) passed, which closes spike S4.
Findings and decisions: the first build succeeded but produced a 1.12 GB image because `chown -R node:node /app` duplicated every copied file in a new layer; ownership is now set on the `COPY` instructions, and the layer is 8 KB. `embedded-postgres` was a runtime dependency only because development uses it; it is now a devDependency loaded with a dynamic import and marked external for tsup, so production images never contain it. A build that failed inside the server bundling step had been reported as success because the build output was piped through `tail`; build commands now preserve their exit code. The image is 614 MB; `pnpm deploy --legacy` still copies about ten development toolchain packages (vite, typescript, esbuild, rolldown, tailwind) into the pruned store, roughly 100 MB, which is scheduled for the hardening milestone (M6.3) rather than fixed now. The install smoke test (`deploy/docker/smoke-test.sh`) is part of the repository and runs in CI after the image build.
Consequences: deployment is verified end to end on this workstation and on every push; the Unraid host remains the last environment to confirm.

## ADR-0030 pnpm settings location and registry resilience (2026-10-22)

Context: the CI run after the image verification failed its tests because suites shared one data directory (fixed by per-app temporary directories), and the following image builds failed locally and in CI at `pnpm install` while npm's status page reported degraded package installation. During the investigation pnpm 12 rejected a setting placed in `pnpm-workspace.yaml` and had silently ignored the same family of settings in `.npmrc`.
Decision: pnpm settings (build-script allow list, overrides, `autoInstallPeers`, fetch retries and timeouts) live in `pnpm-workspace.yaml`; `.npmrc` keeps only npm-compatible keys. The image installs the pinned pnpm with `npm install -g pnpm@12.14.0` instead of corepack, removing the corepack bootstrap fetches. Fetch retries and timeouts are raised so transient registry slowness does not fail a build outright. Registry outages are not treated as build failures: rerun the workflow once status.npmjs.org shows the incident resolved.
Consequences: fewer moving parts in the image build; clearer failure attribution; no change to runtime behaviour.

Addendum (same day): once `autoInstallPeers: false` actually applied, the production install stopped pulling in undeclared peers and the image failed to start: `trpc-to-openapi` imports its peer `zod-openapi`, which is now declared explicitly on the server (range `^5`, matching the peer declaration). The lean install also removed the development toolchain packages that `pnpm deploy --legacy` had been copying (ADR-0029): production `node_modules` is about 72 MB and the image about 427MB. The install smoke test caught the failure; it now gates every push of the image build. Lesson recorded: peers are dependencies and must be declared, and a settings change that silently takes effect later is a change like any other.

## ADR-0031 Static engine representation (M2.2, 2026-10-22)

Context: M2.2 turns the contribution model of RULES_ENGINE.md §3 into code. Several representation questions were open: where shield and armor numbers come from, how an item's own bonuses stay on that item, how the builder stores choice selections and formula-group picks, and what the engine does when stored data is wrong.
Decision: (1) The engine adds no hidden bonuses. Armor and weapon numbers come from the item's structured data; a shield's +2 is a `bonus ac.bonus` effect on the item (emitted by the SRD converter); homebrew shields without the effect give no AC. (2) `attack.weapon.self` / `damage.weapon.self` contributions are kept per inventory row and applied only to that item's action templates; from any other source they are a `SCOPE_VIOLATION`. (3) Choice selections are typed by the choice kind and keyed by `<owner path>/<choice key>`; formula-group picks are stored under `stat:<path>`. Illegal or mistyped selections and overrides are reported (`INVALID_SELECTION`) and ignored rather than failing the sheet. (4) Cycles drop the contribution that closes the cycle, mark that stat `error` and report once per cycle; stats are resolved in sorted path order so the dropped contribution is the same on every run. (5) Static formulas evaluate to numbers only; dice inside a static formula are a `FORMULA_ERROR`, and formulas with dice live on action templates where variables are substituted for display. (6) Exhaustion and unproficient-armor consequences are engine rules, not content, because they are ruleset text with no per-feature variation. (7) Tests that read fixtures from disk are allowed Node imports: the purity lint rule covers `packages/rules-engine/src/**` and the package typechecks `src` without Node types.
Consequences: content stays the single source of item mechanics; the engine's own contributions are few and listed in `static/base.ts`; every stored-data problem surfaces as a diagnostic the UI can show. Spellcasting (`spellcasting.grant`, `spell.grant`, `spellSlots.bonus`) is deliberately deferred to M2.3 and reported as an info diagnostic until then.

## ADR-0032 Action resolution representation and computed dice counts (M2.3, 2026-10-22)

Context: M2.3 implements `planAction`, `applyRolls`, `applyPackets` and spellcasting. Scaling damage such as Sneak Attack needs a dice count computed from a class level, which the formula grammar could not express; the plan needs serializable inputs so the browser can preview actions from the sheet it already holds; and the roll step must be kept outside the engine.
Decision: (1) The grammar gains `dice(count, faces)`: content formulas are validated with the function allowed, the engine substitutes variables and folds constants, and `@scriptorium/dice/ast` normalises `dice(3, 6)` into `3d6` before rolling or computing expectations. (2) `ComputedSheet` carries serializable `facts`, `actionEffects` and `spellcasting`, so `planAction` needs only the sheet, the aggregate, the reference, the context and (for spells and class tables) the snapshot. (3) Unknown action facts are answered immediately from explicit answers, then stored assumptions, then a default, and every such answer is reported as a question plus an assumption; a plan is therefore always complete and the UI decides what to ask. (4) Damage packets carry a `critFormula` with every die doubled; the roll step rolls one or the other after the attack roll, and `applyRolls` refuses to guess a missing roll. (5) Pact magic is tracked apart from ordinary slots; spells use the lowest free slot of at least their level unless told otherwise. (6) Monster defenses are parsed from the SRD text into packet-scope predicates at use time; unparsable lines are reported, not silently dropped.
Consequences: content authors write scaled damage as `dice(expr, faces)`; the client can plan and preview without a round trip; the server's roll step (M2.5/M2.8) is a thin layer over `dice/roll`. The `action.saveDC`, `action.cost` and `action.requiresChoice` effects are handled minimally (a DC add, an extra cost line, a rider text) until content needs more.

## ADR-0033 Alpha content pack: overlays, generated variants and the 95% gate (M2.4, 2026-10-22)

Context: M2.4 authored mechanics for Fighter/Champion, Rogue/Thief, Cleric/Life and Warlock/Fiend at levels 1–20, five species entries and their traits, the Acolyte, the Grappler, the alpha magic items and twelve monsters, with a behavioural case for every full or partial feature. Three things the plan assumed turned out differently: the SRD lists magic weapons and armor generically ("Weapon, +1") with no weapon stats; several magic items need data the converter does not read (charges, a specific weapon's dice); and the SRD class tables convert into feature rows that are not features (archetype-selection rows, "improvement" rows, "domain spells" rows, use-count duplicates), which dominate the manual count.
Decision: (1) Overlays may patch `data` (shallow) so charges and specific-weapon stats are content, not engine special cases. (2) The converter generates concrete `+1`/`+2`/`+3` variants of every mundane weapon and armor, each with the enhancement as ordinary effects and a generated behavioural case on the `item-bench` fixture; the generic SRD templates stay manual with a pointer. (3) Fighting styles use the SRD's per-style feature entries as option features so each style carries its own automation and case. (4) Choice counts may be formulas; content choices grant features and spells (see RULES_ENGINE.md §5); a `ctx.spell` leaf identifies the spell being cast. (5) Table placeholder rows are tagged `placeholder` and listed on the manual allow-list; the coverage report shows the full-or-partial share both over all rows and without placeholders. (6) The 95% gate is **not met** (63.1% / 81.7%) and is not quietly re-based: the conformance test asserts the measured 78% floor against regressions and the plan records the shortfall for the owner's decision at Gate A1 (options: measure over mechanical rows, lower the threshold, or add effect types for the remaining features such as healing modifiers and minimum rolls). (7) Monsters are `partial` (actions resolved by the tracker from M2.8) and verified structurally; a dedicated test checks the twelve alpha monsters have to-hit and damage dice and parseable defenses.
Consequences: content authors can express every alpha mechanic without engine changes except the three small schema additions; the remaining manual features are visible with reasons in `docs/AUTOMATION_COVERAGE.md`; the alpha gate's one unmet number is explicit.

## ADR-0034 Character commands as section patches with pinned content refs (M2.5, 2026-10-22)

Context: ARCHITECTURE.md §5 fixes the command path but left open how a patch is expressed, how undo finds its `before` values, how content versions get pinned and how the browser issues commands.
Decision: (1) A patch replaces whole aggregate sections (`name`, `definition`, `inventory`, `state`) rather than individual rows; the repository rewrites the rows of a replaced section inside the command transaction. Events store the same sections before and after, so undo is a generic `undo` command that writes the stored `before` sections back, and the event log can show exactly what changed. (2) Content versions are pinned by rewriting `character_content_refs` after every command from the snapshot actually used (head versions for new references, pinned versions for existing ones); the snapshot loader follows transitive references from classes, species, features and items but treats spells, spell lists, monsters, conditions and rules as leaves. (3) The command runner recomputes the sheet after the patch with the enlarged snapshot so the stored summary and refs match what the next read computes. (4) The browser sends commands with a client-generated UUID and the revision it last saw; a `CONFLICT` refetches and the user retries. (5) Fastify's `maxParamLength` is raised to 5000 because tRPC batches join procedure paths into one route parameter and a page with five queries exceeded the default of 100, answering 414; the E2E suite caught it.
Consequences: commands and undo need no per-row diffing; every stored-content reference is a pinned version from the first command on; the SSE subscription (M2.6) only needs to listen to the event bus.

## ADR-0035 Interactive sheet: live updates, the roll step and rests (M2.6, 2026-10-22)

Status: accepted.

Context: M2.6 needs the sheet to follow changes made elsewhere (ARCHITECTURE §7), the explicit plan → roll → commit flow of RULES_ENGINE §6 with single-use rolls, and a short rest that spends hit dice without the UI adding the Constitution modifier itself (CLAUDE.md rule 1).

Decisions:

1. **Live updates are a tRPC subscription, not a dedicated route.** ADR-0006 named subscriptions first and spike S2 proved them; a subscription reuses the policy middleware and the owner check instead of a second hand-rolled authorization path. The server sends a `ready` frame with the current revision before the event stream so a reconnecting client detects a gap; the client refetches on any revision difference and polls every 15 s while disconnected. Pings every 25 s and a 60 s client-side inactivity reconnect are set on the tRPC root config (the Fastify adapter does not take them per route).
2. **Rolls are stored with their plan and consumed in the commit transaction.** `characters.roll` plans on the server (never trusting a client plan) and stores plan and results in `rolls`; `characters.commitAction` re-derives the outcome with `applyRolls` and marks the roll consumed through a `prepare` hook that runs inside the command runner's transaction, so the uniqueness of `consumed_by_command_id` and the revision check commit or roll back together. A retried command id replays the receipt (the stored roll already belongs to it); a new command id with a consumed roll fails with `PRECONDITION_FAILED` and changes nothing. Checks and saves are rolled but not committed: there is nothing to spend. Hit dice (`characters.rollHitDie`) are rolled on the server and recorded, but not consumed: the short-rest command carries the shown value, as it would for physical dice.
3. **Short rest takes die results, the engine adds the modifier.** The command changed from `{ die, healed }` to `{ die, roll }`: the engine adds `ability.con.mod` per die (minimum 0) and refuses a value the die cannot show. The old shape would have required the UI to add the modifier. Pre-Gate A1, so no migration; the engine test and server schema changed with it.
4. **The character page is split into one module per section** (`apps/web/src/pages/character/`): vitals, actions and the action card, resources and rests, conditions and toggles, coins, overrides, choices, inventory, spells, level-up, history, diagnostics. The page composes them and owns the single error line and the command sender.
5. **Print is a stylesheet, not a renderer.** `@media print` and Tailwind `print:` variants hide controls and the shell; the browser's "Save as PDF" is the 1.0 export (PRODUCT_SPEC).
6. **E2E restarts are a supervisor concern.** `e2e/start-server.mjs` restarts the server when a request file appears; no test hook exists in the application. The restart spec runs in its own Playwright project after the viewport projects.

Consequences: the SSE transport depends on one server process (the in-process bus); a multi-instance deployment would need a shared bus, which is out of scope. Because a stream never ends on its own, Fastify runs with `forceCloseConnections: true` so a graceful shutdown (SIGTERM from Docker or the E2E supervisor) drops open streams instead of waiting for them; clients reconnect and refetch on the revision gap (a server test proves `close()` returns with a stream open, and CI's Linux restart found the hang that Windows's hard kill had hidden). The `rolls` table grows with every action roll; retention is a later concern (same as `command_receipts`). The 2014 "minimum 0 per die" rule is applied per die, recorded in the ambiguity register as A-009.

## ADR-0036 Homebrew thin slice: personal sources, drafts, visibility and previews (M2.7, 2026-10-22)

Status: accepted.

Context: M2.7 needs authors to create a magic item with real mechanics (static bonuses, charges, a granted spell, target-typed damage), preview it on a character, publish it and hand it out, without a second content model and without weakening rules 3, 5 and 6 of `CLAUDE.md`.

Decisions:

1. **Homebrew is ordinary content.** Items live in `content_entries` / `content_versions` under a source of kind `homebrew` that the author owns (`owner_user_id`, `visibility = private`). A user creates sources by name; the slug is derived and made unique. Nothing about an entry says it is homebrew except its source, so the compendium, the snapshot loader, pinning and the engine treat it exactly like SRD content.
2. **Drafts are mutable, published versions are not.** `content_entries.draft_version_id` points at a version row that `save` rewrites in place; `publish` moves `head_version_id` to it, clears the draft pointer and rebuilds tags, relations and the item projection. Saving after publishing opens version n+1 as a new draft. Characters pin the version they were given (`character_content_refs`), so a republish never changes an existing sheet; the consent and upgrade flow is M3.4. Published entries cannot be deleted; unpublished drafts can.
3. **Visibility is enforced in SQL, not in the UI.** `content.entries.list` and `content.entries.get` take the viewer: global sources are visible to everyone, private sources to their owner and to administrators. The character command path refuses `addItem` for a uid the owner cannot see. Drafts never appear in the compendium (status filter). Campaign sharing (M2.8) widens the predicate rather than adding a path around it.
4. **The editor speaks content-schema.** The Effect Builder's rows are translated client-side into `bonus`, `action.damageAdd` (with a `ctx.targetType` condition), `spell.grant` and `manual` effects; effects it does not model are kept as read-only advanced rows. The server validates the full entry with `contentEntrySchema` on save and publish, and a loose-input `validate` procedure returns every issue by path so the form can show them as the author types. The automation level is inferred from the effects (full, partial with the manual texts as manual parts, or manual); an author cannot claim more than the effects deliver (rule 7).
5. **Preview is a pure computation.** `homebrew.items.preview` loads the character, merges the draft entry into its snapshot, adds a synthetic equipped-and-attuned inventory row and runs `computeSheet` and `planAction` against an imagined target type. It returns the item's action templates, the plan, granted spells, the numeric stats that changed and any diagnostics. Nothing is written; giving the item is an ordinary `addItem` command.

Consequences: granted item spells are listed on the sheet (with their charge or use cost) but cannot yet be cast from an action card, because `planAction` resolves spells through class spellcasting sources only; that is recorded as a limitation for the spell mechanics work after 1.0's spell import. The `item_index` projection has no cost for homebrew (cost is optional). The sheet gained an `items` view (names, activation reason, charges) because the inventory panel had been title-casing uid slugs, which mangles homebrew names; and `addItem` now fills a charged item's charges from its content unless the command sets them. Source attribution is "Homebrew by <author>" and the licence string is the author's; export of homebrew packages arrives with M3.4.

## ADR-0037 Campaign and encounter thin slice: DM permissions, coordinator transaction, role views (M2.8, 2026-10-22)

Status: accepted.

Context: M2.8 needs campaigns (invite, join, submit, approve, share homebrew) and an encounter tracker whose attacks go through one transaction with receipts and single-use rolls (ARCHITECTURE §6), on top of the character command path of M2.5 and the roll step of M2.6, without a second write path for characters.

Decisions:

1. **DM table permissions are a fixed command allow-list on approved party characters.** The DM of the campaign a character is approved in may read the sheet and issue `addItem`, `applyDamage`, `heal`, `setTempHp`, `applyCondition`, `removeCondition`, `setExhaustion` and `turnStarted`; everything else stays with the owner. Checked in the character service (never the UI), by looking up the approval row. The broader DM sheet access of M4.1 (`dm_can_edit_characters`) will widen this list rather than bypass it.
2. **The command runner exposes its transactional core.** `applyInTx` runs one character command inside a caller's transaction (receipt optional, `actionId` recorded on the event); the coordinator uses it so an attack's attacker patch, target damage, encounter event, version bump and receipt commit or roll back together. The lock order is encounter row first, then characters by ascending id.
3. **Rolls carry their plan.** `attackRoll` stores the resolved plan with the results in `rolls`; `commitAttack` derives the outcome from the stored plan, never from client data, and the roll's `consumed_by_command_id` makes it single-use. Monster attacks are stat-block attacks (to-hit bonus, damage dice, criticals doubling dice at roll time); they do not go through `planAction`, which is M5.3's job.
4. **Character targets take packets as `applyDamage` commands, monsters through `applyPackets`.** One command per packet keeps the character's defenses, temp hit points and event log inside the engine; monsters have no aggregate, so their row is updated directly with the engine's packet resolution against `monsterDefenses`.
5. **Role serializers in the service.** Players get the encounter without monster hit points, AC or attack options and without DM notes; the DM gets everything. Campaign reads require membership; the DM is also a member row so the visibility subquery for shared sources has one shape.
6. **Invites are hashed codes with expiry and use counts**, mirroring instance invites; the join page takes the code from the link.

Consequences: a solo sheet attack and an encounter attack share the roll step and the engine but not the commit procedure (two thin wrappers over the same core). Players cannot yet act in the tracker (the DM resolves every attack); concentration prompts, legendary actions, hidden combatants and monster actions through `planAction` remain M5.3. The engine's own combat tests still prove the reset rules; the server test proves the tracker issues the commands.

## ADR-0038 Gate A1: conditional pass with a limited coverage exception (owner decision, 2026-10-22)

Status: accepted (owner).

Context: `docs/ALPHA_GATE_REVIEW.md` found the architecture sound, every suite green and the two-instance restore acceptance passing, but the alpha coverage gate unmet: 63.1% of all class and subclass feature rows, 81.7% of non-placeholder rows, 89.5% after the ten narrative or table-adjudicated rows, against ≥ 95%, with six features conflicting with the rule that numeric or resource-bearing mechanics be `full`.

Decision (owner): conditional pass of Gate A1 with an explicit, limited exception. The original metrics stand unchanged and the exception is not compliance with the threshold. The 34 structural placeholder rows are non-mechanical for future reporting; the 10 narrative rows are named A1 exceptions with their allow-list reasons; the target of ≥ 95% `full`/`partial` of eligible mechanical features, with numeric or resource-bearing mechanics `full`, is preserved. The 11 incomplete mechanical features are a mandatory remediation workstream at the beginning of M3.2, and the six numeric conflicts must be resolved, not waived; broad SRD class expansion waits for that workstream or an approved revised plan. D-1, D-2 and D-4 are early M3.2 deliverables; the other deferrals keep their recorded destinations. Before Phase 3: D-3 (no monster hit points or other DM-only fields through any player-visible encounter response, with regression tests), D-6 (CLI documentation) and D-7 (backup documentation), narrowly scoped. A1 is not marked verified; owner acceptance testing remains outstanding.

Consequences: the plan's M3.2 definition and `TEST_STRATEGY.md` §4 carry the clarified reporting rule; `AUTOMATION_COVERAGE.md` keeps reporting both the all-rows and the non-placeholder shares. Usage continues to be reported from the account tool's cumulative figure (owner checkpoint $239.92), never as per-milestone billing.

## ADR-0039 A1-R: bounded remediation before A1 verification (owner approval, 2026-10-22)

Status: accepted (owner).

Context: owner acceptance testing on Unraid passed the whole scenario (`docs/A1_RECONCILIATION.md` §1) and left nineteen open issues. The owner approved the reconciliation report's sequence and authorised one bounded milestone, A1-R, limited to issues #3, #5, #13, #19 and #8, before A1 is marked verified. Phase 3, UX-1 and UX-2 are not authorised; ADR-0038, the coverage accounting and the mandatory M3.2 remediation workstream are unchanged.

Decision:

1. **Conditions have one source of truth (#13).** A character participant's conditions are read from the character aggregate in every encounter response; the participant row's `conditions` column holds conditions for monsters only. `encounters.subscribe` forwards `character.changed` for every character in the encounter (refreshing that set whenever the encounter changes), and the tracker refetches on those frames regardless of the encounter version. `characters.subscribe` is authorised exactly like `characters.get` (owner, administrator, or DM of an approved party character), so the DM can follow a sheet live as well.
2. **Rolled ability scores are the server's roll (#3).** `characters.rollAbilities` rolls `4d6kh3` six times with the cryptographic RNG and records the results in `rolls` (context `abilityScores`). Creation with `abilityMethod: 'rolled'` and `setAbilities` with `method: 'rolled'` require the roll id, verify the owner, the unconsumed state and the exact multiset of scores, and consume the roll inside the creating or command transaction (`consumed_by_command_id` holds the character id or the command id; a retried command id replays its receipt). Typed-in scores never carry the Rolled designation. The method rules shared with the `setAbilities` command moved into the engine's exported `validateAbilityScores`, so creation refuses what the command refuses (a repeated standard-array value, point buy over budget or out of range). The builder renders each method on its own: swap-assigned dropdowns for the array and for rolled results, bounded `+`/`−` controls with a budget for point buy, number inputs for manual.
3. **Language choices keep `setChoice` replacement semantics (#5).** The engine is unchanged. The picker shows one select per open slot over the standard and exotic language list plus "Other…", disables known or already-chosen languages and repeats, allows saving fewer than all slots, and always submits the earlier picks plus the new ones. The language list lives in the web client (`apps/web/src/lib/languages.ts`) as display vocabulary; moving it into the ruleset profile is deferred to the compendium work, because adding a ruleset-config field is a content-schema change. The sheet gains a Proficiencies card (armor, weapons, tools, languages) from `sheet.proficiencies`. Known gap recorded, outside A1-R: the alpha species overlays keep languages as prose (no `language.grant`), so Common and a species' own language are not yet listed or disabled as known; the M3.2 species work grants them.
4. **Sheet links are server-decided (#19).** Each participant carries `canOpenSheet` (DM, administrator, or the character's owner; always false for monsters). The client renders the link only when it is true; the character service's read check is unchanged and remains the enforcement.
5. **Granted spells are `partial` (#8).** `inferAutomation` reports `partial` with a manual part naming the spell whenever an item grants a spell, because casting it from the sheet is not automated (D-4, M3.2). The engine's stale `UNSUPPORTED_EFFECT` info for `spell.grant` ("not reflected on this sheet yet") becomes a `PARTIAL_AUTOMATION` info that says what is and is not automated; `spellcasting.grant` and `spellSlots.bonus`, which the spellcasting module fully computes, no longer emit the misleading info. Class and subclass features that grant spells (warlock invocations, Pact of the Chain) are covered by the same D-4 limitation; their declared levels and the ADR-0038 accounting are not touched here and are addressed by the M3.2 remediation workstream.

Consequences: no migration; `commandRequestSchema` and `createCharacterSchema` gain an optional `abilityRollId`; the encounter response gains `canOpenSheet`; the homebrew sword example is now `partial` in tests and docs. Tests: server (`characters.test.ts` ability methods, rolled verification and language merging; `encounters.test.ts` sheet/tracker condition round trip, subscription forwarding, `canOpenSheet`; `homebrew.test.ts` automation and diagnostics), E2E (`characters.spec.ts` methods and languages on desktop, tablet and phone; `acceptance.spec.ts` concurrent sheet and tracker, player sheet links; `homebrew.spec.ts` partial badge). The Unraid retest checklist is `docs/A1R_RETEST.md`. A1 stays "conditional pass; owner testing passed; remediation pending" until the owner's retest.

## ADR-0040 Issue #21: background completion on the sheet; `setBackground` drops obsolete selections (final A1 correction, 2026-10-22)

Status: accepted (owner-directed).

Context: the owner's Unraid retest of A1-R (767e681) passed all five items and found one more functional-completion defect: the builder allows creating a character without a background, and the sheet offered no way to choose one afterwards (issue #21). The engine and server already supported `setBackground`. The owner directed the smallest complete correction before A1 verification, keeping incomplete drafts allowed, and recorded three further findings as deferrals: #22 character deletion UI (UX-1), #23 human-readable homebrew automation wording (UX-1), #24 species-granted languages (M3.2 content remediation, now part of the mandatory workstream).

Decision:

1. **Sheet workflow.** A Background card shows "Not selected" or the background's name and its feature, lists the content system's backgrounds by name, and issues the existing `setBackground` command through the normal command path (owner or administrator; revision, receipt, event, snapshot pinning and live update unchanged). While no background is set the card sits at the top of the sheet next to the pending choices and the page header reads "Background: Not selected". Background selection stays optional at creation.
2. **Changing a background invalidates its selections.** The engine's `setBackground` now drops every stored selection whose choice key starts with `background:<previous uid>/` when the background changes or is cleared (the event summary records "reset N choices"); setting the same background again keeps them. Grants were never stacked, because the grants walk reads only the current background, but orphaned selections would have silently reappeared when that background returned. The sheet warns before a change that would drop selections and requires a second press. Species selections are not touched by this ADR (`setSpecies` has no sheet workflow yet; the same pattern applies when it gets one).
3. **Verification.** Engine tests (`commands.test.ts`: change to a second, inline background; same background again; clear; unknown background refused), server tests (`characters.test.ts`: draft without a background, stranger refused, unknown refused, choose Acolyte, complete and persist languages and class skills, same-background no-op, clear drops only the Acolyte selection, choose again starts afresh, a character created with Acolyte unaffected), E2E (`characters.spec.ts` on desktop, tablet and phone; `restart.spec.ts` chooses the background on the sheet and checks it after the server restart).

Consequences: no schema or migration change; `docs/RULES_ENGINE.md` §8 notes the invalidation rule; the SRD ships one background (Acolyte), so the "change to another background" path is proven by the engine test with an inline fixture and the sheet path by removing and re-choosing. ADR-0038 and the coverage accounting are untouched. A1 remains unverified until the owner's retest of #21.

## ADR-0041 UX-1: safety and clarity on the sheet (owner-authorised milestone, 2026-10-23)

Status: accepted (owner-authorised scope; owner acceptance on Unraid pending).

Context: with A1 verified under ADR-0038's limited exception, the owner authorised the usability milestone proposed in `docs/A1_RECONCILIATION.md` §4 (issues #22, #6, #15, #10, #14 short form; #23, #11, #7, #9, #4 first pass) in two internal checkpoints, with safeguards for deletion, level-up rollback and item provenance. UX-2, M3.1, M3.2 and later milestones stay unauthorised; ADR-0038 and the mandatory M3.2 remediation list are untouched.

Decision:

1. **Deletion (#22).** `characters.delete` remains owner-or-administrator; a campaign DM's table rights never include it. The service refuses, naming the campaign or encounter and what to do, while the character is pending or approved on a roster or in an encounter that is not completed. Events, snapshots, receipts and completed encounters are kept (a finished encounter renders a deleted character's row without sheet facts); the row is soft-deleted and a repeated request is 404. A new `campaigns.characters.withdraw` (owner of the character or the DM; refused while the character is in an unfinished encounter of that campaign) retires the roster row, which also ends the DM's table rights on that sheet; the row stays as history and the character can be submitted again. The sheet's Manage card confirms by typed name and says plainly that there is no restore control.
2. **Level-up rollback (#15).** `characters.revertLevelUp` reuses the automatic `level_up` snapshot and the audited `restoreSnapshot` command. It is offered (through `undoAvailability.levelUp`) and executed only when the latest event is the level-up and exactly one `level_up` snapshot sits at the previous revision; the check runs again inside the command's own transaction under the row lock (the runner's `prepare` hook, no nested transaction), optimistic concurrency, receipts, event history and actor attribution are the ordinary command path's, and the result is a new forward revision. The control says it restores the whole previous state.
3. **Confirmations (#6).** Long rests and level-ups use an inline two-step prompt (`ConfirmButton`) that states what will happen; the same component serves the revert, the roster withdrawal and the delete flow.
4. **Inactive effects (#10).** Equipped items whose effects do not apply show "effects inactive · reason" next to an Attune control; the control appears only for attunement items.
5. **Provenance (#7).** Item data gains an optional `basedOn { uid, name?, source?, versionId?, versionNo? }` recorded by the editor when weapon stats are copied from an SRD item. It is a one-time copy with a reference, never live inheritance; existing published uids and pinned versions are untouched and no data migration is needed (older items have no `basedOn`).
6. **Wording (#23).** The homebrew service resolves granted-spell names from the content system (falling back to a readable form of the uid) so manual parts read "Bless is granted (1 charge), but casting it from this item is not automated yet"; the engine's `PARTIAL_AUTOMATION` info moved to the spellcasting module, where the spell's name is known. The editor's validation card lists manual parts in words; the preview shows errors and warnings in words and keeps codes under a disclosure. `partial` stays accurate until D-4.
7. **Target prompt (#9) and item details (#11).** The preview asks for the imagined creature type before the plan and labels the plan as missing the conditional damage until answered; every inventory row has a read-only Details disclosure (description, type, weapon or armor numbers, charges, effects as sentences, current inactive state, provenance, source and version), fetched from the content system when opened.
8. **Layout (#4, first pass).** The sheet is organised as Needs your attention (missing background or class, open choices), Play, Character, Equipment and Management, one column on a phone in that order, with errors in one place under the header; the builder's cards are numbered and say that "Choose later" items are completed on the sheet. The remaining #4 and #14 work stays in UX-2.

Consequences: no SQL migration; `campaign_characters.status` now uses `retired`; the encounter response tolerates a deleted participant character; `undoAvailability` carries `levelUp`. Verification: `pnpm test` 339 passed (33 files); `pnpm test:e2e` 69 passed, 2 intentional skips; coverage unchanged (1,948 entries, 336 verified, alpha 63.1%); CI green for checkpoint A (e94408b) and for the milestone commit. Owner acceptance checklist: `docs/UX1_RETEST.md`; the UX-1 issues are closed by the owner's confirmation, not by the push.
