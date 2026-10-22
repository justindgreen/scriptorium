# Architecture

Scriptorium is a modular monolith: one server process serving a single-page application and a typed API over PostgreSQL, with the rules engine isolated in a pure package that runs on both server and browser. This document is the structural reference. The engine's behaviour is specified in `RULES_ENGINE.md`; tables are in `DATA_MODEL.md`.

## 1. Stack

| Layer     | Choice                                                                                                                                                                                    | Notes                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Runtime   | Node 24 LTS, TypeScript 5 strict, ESM, pnpm workspaces, Turborepo                                                                                                                         | Turborepo is used only for the task graph and caching |
| Web       | React 19, Vite, TanStack Router, TanStack Query, Tailwind CSS v4, shadcn/ui on Radix primitives (copied in), react-hook-form + Zod, CodeMirror 6 (lazy), react-markdown + rehype-sanitize | SPA; no SSR                                           |
| API       | Fastify 5, tRPC v11 (Fastify adapter), Zod 4, `trpc-to-openapi` for the transfer/health REST surface                                                                                      | Verified by spike S2; fallbacks in §10                |
| Data      | Drizzle ORM, drizzle-kit SQL migrations, `pg`, PostgreSQL 17                                                                                                                              | 16 tolerated with a startup warning                   |
| Auth      | Better Auth 1.7 (ADR-0024): Drizzle adapter on our own tables, username and admin plugins, DB-backed cookie sessions, invite-gated sign-up through a before-hook, built-in rate limiting  | The policy module is independent of the auth library  |
| Real-time | Server-Sent Events via tRPC subscriptions; fallback dedicated SSE route                                                                                                                   | Post-commit emission only                             |
| Files     | Local disk `DATA_DIR/uploads`, content-addressed by sha256, images re-encoded by `sharp`                                                                                                  | Immutable files                                       |
| Dice      | `@scriptorium/dice/ast` (no RNG) and `@scriptorium/dice/roll` (injectable RNG)                                                                                                            | Engine may import `ast` only                          |
| Logging   | Pino                                                                                                                                                                                      |                                                       |
| Tests     | Vitest, fast-check, Playwright + axe-core, golden and conformance suites                                                                                                                  | See `TEST_STRATEGY.md`                                |

Rejected alternatives and reasons are in `DECISIONS.md`. The web app's visual system (tokens, fonts, themes, generated components, shell patterns) is documented in `DESIGN_SYSTEM.md`.

## 2. Repository layout

```
apps/
  web/                     SPA. Routes, components, feature folders. Renders ComputedSheet/ActionPlan.
  server/
    src/core/              config, db, logger, errors, session, policy, sse, audit, commands
    src/modules/<domain>/  router.ts service.ts repo.ts policy.ts schemas.ts commands.ts *.test.ts
                           domains: auth users admin rulesets content homebrew characters campaigns
                                    encounters monsters rolls files transfer backup
    src/cli/               migrate, import-content, create-admin, backup, restore, verify-backup, migrate-json
packages/
  rules-engine/            static/ actions/ commands/ rulesets/ hooks/ diagnostics/ test/golden/
  dice/                    ast/ roll/
  content-schema/          kinds/ effects/ predicates/ choices/ statPaths/ automation/ packages/
content/srd-5.1/           packages + mechanics/ overlays + attribution
tools/srd-import/          converter from upstream SRD data and overlays to packages
deploy/docker/             Dockerfile, compose.yml, compose.dev.yml
deploy/unraid/             Community Applications template and guide assets
docs/
```

## 3. Module boundaries

Enforced by per-directory `@typescript-eslint/no-restricted-imports` rules in `eslint.config.js` (proven by `test/boundaries.test.ts`), package `exports`, and, from M1.3, `eslint-plugin-boundaries` for intra-server layering:

- `rules-engine` imports only `content-schema` and `dice/ast`. No Node built-ins, DB, HTTP, React or `dice/roll`.
- `dice/ast` has no dependencies; `dice/roll` depends on `dice/ast` and takes an injected die roller (crypto RNG in production, seeded in tests, scripted for physical dice).
- `content-schema` depends only on Zod.
- `web` imports the server's `AppRouter` type only, plus `rules-engine`, `dice/ast` and `content-schema` for previews and validation. No stat arithmetic in components.
- `server` modules depend on `core/*` and on `rules-engine`, `dice`, `content-schema`. Modules do not import each other's repos; cross-module needs go through services.
- Every tRPC procedure asserts policy before data access. Repos take a `Scope` and filter rows in SQL.
- All character writes go through `core/commands`.

## 4. Request lifecycle

1. Fastify receives the request; the session plugin resolves the user (or anonymous) and builds the tRPC context `{ user, scope, db, policy, sse, logger, requestId }`.
2. The tRPC procedure validates input with Zod, calls `ctx.policy.assert(action, resource)`, then the module service.
3. Services use repos (scoped SQL) and, for characters, `core/commands`.
4. Responses are serialized through role serializers where DM-only fields exist.
5. Errors are structured (`code`, `message`, `details`) and logged with `requestId`; validation and policy errors never leak internal details.

Rate limiting (`@fastify/rate-limit`) applies to login, setup, invite acceptance and import endpoints with per-IP and per-account keys.

## 5. The character command path

The character is one aggregate (definition + inventory + runtime state) with a single `characters.revision`. Every write is a command.

```
procedure -> core/commands.run({ commandId, aggregateId, expectedRevision, command })
  1. receipt check: command_receipts[commandId] exists -> return stored outcome (idempotent retry)
  2. BEGIN; SELECT characters ... FOR UPDATE; verify expectedRevision (409 on mismatch with current aggregate)
  3. load definition + inventory + state; load ContentSnapshot (memoised by version set); computeSheet
  4. rules-engine.applyCommand(aggregate, sheet, command) -> { patch, event } or structured error
  5. apply patch rows; INSERT character_events (before/after, revision_after, reversible);
     revision += 1; snapshot if the command type requires; refresh character_content_refs if references changed;
     INSERT command_receipts; COMMIT
  6. post-commit: recompute sheet (memoised), emit SSE to subscribers permitted to see the character
```

Snapshots are written before level-up, rests, imports, content-update acceptance and on manual request; retention is configurable (20 automatic snapshots per character; manual ones are kept). Implementation notes (M2.5): `core/commands.ts` is the runner; the content snapshot is loaded from `character_content_refs` (pinned versions) plus the uids the command itself introduces, and the refs are rewritten after every command so new references are pinned at their head version; the `characters` module owns the repository, the snapshot loader, the service (ownership: owner or administrator) and the tRPC router; a post-commit `character.changed` event goes to the in-process bus that SSE will subscribe to. Undo is a compensating command for the latest reversible event (see `RULES_ENGINE.md` §8 for the exact limits).

## 6. The encounter action coordinator

A combat action touches an attacker, a target and the encounter. The encounters module owns a coordinator built on `core/commands`:

1. The client builds an `ActionPlan` (via `planAction`) and requests rolls; the server persists each roll in `rolls` and returns results.
2. The client (or the DM's tracker) submits `commitAction { commandId, encounterId, actorRef, targetRef, planHash, rollIds, expectedRevisions }`.
3. Receipt check. Then one transaction: lock the encounter row, then the involved aggregates in ascending id order; verify revisions; mark `rolls.consumed_by_command_id` (unique, so a roll is applied once); `applyRolls` → outcome; apply the attacker patch (`applyActionOutcome`); apply target packets (`applyPackets`) as a character command or a monster participant update; append events to both character logs and `encounter_events` with the same `actionId`; bump all touched revisions; write the receipt; commit.
4. Any failure rolls back the whole transaction and returns a structured error. Nothing is half-applied.
5. SSE notifications are emitted after commit.

Solo sheet actions (no encounter) use the same path with a virtual target: only the attacker patch and receipt are written.

Turn progression: when the tracker moves the turn marker it issues `turnStarted { turnId, ownTurn }` commands to every participant; the 2014 reset rules are in `RULES_ENGINE.md` §7.

## 7. Real-time

SSE channels per campaign and per character. Subscriptions are authorized like queries; payloads pass through the same role serializers, so a player subscribed to an encounter receives only player-visible changes. Clients reconcile by refetching on `revision` gaps. Polling is the fallback when SSE is unavailable.

Implementation (M2.6): `characters.subscribe` is a tRPC subscription (async generator) served as Server-Sent Events through the Fastify adapter, so it runs the same policy middleware and owner check as `characters.get`. It yields a `ready` frame with the current revision, then every post-commit `character.changed` / `character.deleted` from the in-process event bus for that character until the client disconnects. The root tRPC config pings every 25 s and tells the client to reconnect after 60 s of silence. The web client splits links (`httpSubscriptionLink` for subscriptions, batched HTTP for the rest); on every frame it compares the event's revision with the cached view and refetches on a difference, and while the stream is not connected the character query polls every 15 s. The bus is in-process, so one server instance is assumed (the deployment topology). Open streams are dropped on shutdown (`forceCloseConnections: true`), otherwise a graceful close would wait for them forever.

## 8. Content pipeline

- `content-schema` validates every content version before it is stored (kind data, effects with scope, choices, automation metadata).
- Official SRD content is converted offline by `tools/srd-import` into committed packages under `content/srd-5.1/`, merged with hand-authored mechanics overlays; `import-content` loads packages idempotently by `uid` and checksum.
- Projection tables (`spell_index`, `item_index`, `monster_index`) and `content_entries.search_vector` are rebuilt on publish.
- Characters reference `content_versions`; `character_content_refs` is maintained by the command path.

## 9. Deployment topology

- One application container (`node:24-bookworm-slim`, non-root) serving API and static SPA on `PORT`, with `/data` for uploads, backups and logs; one `postgres:17` container with its own volume.
- Start sequence: validate env → advisory lock → SQL migrations → JSON migrators → serve. `/healthz` (process) and `/readyz` (DB reachable, migrations current, not in maintenance).
- Environment: `DATABASE_URL`, `APP_SECRET`, `DATA_DIR`, `PORT`, `PUBLIC_URL`, `TRUST_PROXY`, `COOKIE_SECURE` (auto), `LOG_LEVEL`, `BACKUP_CRON`, `BACKUP_RETENTION`.
- Unraid: a Community Applications template (`deploy/unraid/scriptorium.xml`) plus a guide; no Compose required. Generic Docker hosts use `deploy/docker/compose.yml`.
- Backup unit: `manifest.json` (versions, counts, file list with sha256) + `db.dump` (`pg_dump -Fc --no-owner`) + `uploads.tar` captured after the dump. Uploads are immutable and content-addressed, and orphan cleanup waits longer than the backup window. `verify-backup` checks checksums and references. `restore` verifies → maintenance mode → `pg_restore --clean --if-exists` → unpack uploads to staging and swap → migrations if needed → re-verify → leave maintenance. Restore acceptance is tested against a second instance (see `TEST_STRATEGY.md`).

## 10. Integration spikes and fallbacks (M1.2)

| Spike                   | Verify                                                                                                                                                                                                      | Fallbacks in order                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| S1 dev database         | `embedded-postgres` 17.x on this Windows workstation: initdb/start/stop as the current user, migrations, Vitest boot, `pg_trgm` and tsvector                                                                | PGlite (in-process Postgres 17, single connection) → native PostgreSQL service → Docker Desktop                                   |
| S2 API stack            | tRPC v11 on Fastify 5 with SSE subscriptions through the adapter and behind a proxy; `trpc-to-openapi` emits valid OpenAPI 3 for transfer procedures                                                        | Dedicated SSE route on `reply.raw`; Fastify routes with `fastify-type-provider-zod` + `@fastify/swagger` for the transfer surface |
| S3 auth                 | Better Auth: offline username/password without email, Drizzle adapter on our schema, DB cookie sessions, admin/role plugin, rate limiting, invite-gated sign-up, acceptable footprint and release stability | Own implementation per the Lucia guide patterns                                                                                   |
| S4 production DB parity | Migrations and integration suite on `postgres:17` in CI or on Unraid; startup version check                                                                                                                 | Pin supported versions; add 16 to the matrix only if needed                                                                       |
| S5 native modules       | `sharp` on Windows and in `node:24-bookworm-slim`; embedded Postgres binaries cacheable offline                                                                                                             | `jimp`; vendored binaries                                                                                                         |

Outcomes are recorded in ADR-0024 with the command output that proves them: S1 go, S2 go, S3 go (Better Auth adopted), S4 partial until the first CI run, S5 go on Windows with the Debian check pending the first image build.

## 11. Security

Password hashing (Argon2id or the auth library's equivalent); DB-backed sessions with sliding expiry and revocation; `__Host-` cookies when secure; Origin/Sec-Fetch-Site checks on mutations; strict CSP (self only, fonts bundled); security headers; rate limits; Zod on every input; markdown stored as text and rendered through a strict sanitizer allow-list; uploads size-limited, type-sniffed, re-encoded, served with `nosniff`; audit log for admin and DM-sensitive actions; transactions and optimistic concurrency on aggregates; policy checks in every procedure; SQL row filtering; dependency audit in CI.

## 12. Controlled change after Gate A1

After the alpha gate, a change to the engine API, the content schema or the aggregate shape requires: an ADR in `DECISIONS.md`; SQL and/or JSON migrations with a migration test from a fixture of the previous shape; green golden, conformance and E2E suites; updated docs. Content-schema changes bump the schema version and ship a migrator for stored `content_versions`.
