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
