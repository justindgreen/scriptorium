# Scriptorium — guide for Claude Code sessions

Scriptorium is a self-hosted D&D 5e character, content and campaign platform: the core of D&D Beyond with first-class homebrew, campaign tools and local data ownership. It is a modular monolith: a Vite/React SPA served by one Fastify + tRPC server over PostgreSQL, with a pure rules-engine package shared by server and browser. It runs on Unraid in Docker and works offline after install. SRD 5.1 (2014) is the initial content under CC-BY-4.0.

Read this file, then `docs/IMPLEMENTATION_PLAN.md` for the current milestone and status, then the doc relevant to your task. Architectural context lives in `docs/`, not in chat history.

## Documents

| File | Use it for |

|                               | Tokens, fonts, themes, generated components, shell patterns, accessibility rules                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PRODUCT_SPEC.md`        | Requirements, the 1.0 boundary, the acceptance scenario, what we do not want                                                                                                                             |
| `docs/ARCHITECTURE.md`        | Stack, repository layout, module boundaries, command path, encounter coordinator, SSE, deployment, security, post-alpha change process                                                                   |
| `docs/DATA_MODEL.md`          | Every table and JSON shape, aggregate and revision rules                                                                                                                                                 |
| `docs/RULES_ENGINE.md`        | Engine contract: static sheet, contribution model, stat paths, effects, predicates, formulas, action resolution, turn bookkeeping, commands and undo, automation levels, diagnostics, ambiguity register |
| `docs/IMPLEMENTATION_PLAN.md` | Milestones, measurable criteria, dependencies, status, evidence, measured usage. Keep it current.                                                                                                        |
| `docs/DECISIONS.md`           | ADR log. Append new entries; never rewrite old ones.                                                                                                                                                     |
| `docs/TEST_STRATEGY.md`       | Suites, golden and behavioural case formats, gates, restore acceptance                                                                                                                                   |
| `docs/DESIGN_SYSTEM.md`       | Tokens, fonts, themes, generated components, shell patterns, accessibility rules                                                                                                                         |
| `docs/CONTENT_FORMAT.md`      | Package and entry format, import semantics, converter and overlays                                                                                                                                       |
| `docs/LICENSES.md`            | Game content and software licences                                                                                                                                                                       |
| `docs/DEPLOYMENT.md`          | Docker, Compose, Unraid install, environment, updates, backup and restore                                                                                                                                |

## Repository layout (target; created progressively from M1.1)

```
apps/web            Vite React SPA (renders ComputedSheet and ActionPlans; never computes rules)
apps/server         Fastify + tRPC + Drizzle; CLI (migrate, import-content, create-admin, backup, restore, verify-backup, migrate-json)
packages/rules-engine   Pure TS, zero I/O, no RNG: static/, actions/, commands/, rulesets/, hooks/, diagnostics/
packages/dice           ast/ (parse, validate, format, expected value) and roll/ (evaluate with injectable RNG)
packages/content-schema Zod schemas: content kinds, effects, predicates, choices, stat paths, automation metadata, package formats
content/srd-5.1         Converted SRD packages and our mechanics overlays
tools/srd-import        Upstream SRD data + overlays -> packages
deploy/docker deploy/unraid docs
```

## Commands (keep this list accurate)

```bash
npm install -g pnpm         # once per machine (corepack enable needs admin rights on this workstation)
pnpm install
pnpm dev                    # web on :5173 (proxies /api, /healthz, /readyz) + server on :3000
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm build                  # server bundle (tsup) + web (vite)
pnpm test:e2e               # builds, serves apps/web/dist from the server on :3100, runs Playwright
pnpm exec playwright install chromium   # once per machine, before test:e2e
pnpm -F @scriptorium/server cli -- <command>   # migrate | seed [dir] | import-content <file...> | sources
pnpm -F @scriptorium/srd-import download -- --out <abs dir>              # upstream 5e-bits dataset (gitignored under .data/)
pnpm -F @scriptorium/srd-import convert -- --source <abs dir> --out <abs content/srd-5.1>   # regenerate packages with overlays
pnpm coverage:automation   # conformance run; regenerates docs/AUTOMATION_COVERAGE.md
```

Toolchain notes: TypeScript is pinned to 6.x until typescript-eslint supports 7.x (ADR-0023). pnpm 12 reads its own settings from `pnpm-workspace.yaml` (build-script allow list, overrides, peer and fetch settings); keys in `.npmrc` are ignored or rejected, so never put pnpm settings there. Docker image builds and `pnpm install` depend on registry.npmjs.org; when it is degraded (status.npmjs.org) builds fail at `pnpm install` and should simply be retried.

## Non-negotiable rules

1. **No rules math outside `packages/rules-engine`.** Components display `ComputedSheet` values and `ActionPlan`s. If the UI needs a number, the engine produces it with a breakdown.
2. **The engine is pure and never rolls.** It may import `@scriptorium/dice/ast`, never `@scriptorium/dice/roll`, Node built-ins, DB or HTTP. Dice are symbolic until an explicit roll step.
3. **Every tRPC procedure asserts policy** through `core/policy` before touching data; repositories filter rows in SQL by scope. DM-only fields are removed by role serializers. Never rely on UI visibility.
4. **All character writes go through `core/commands`** as commands with `expectedRevision` and a client `commandId`. Each command runs in one transaction, applies an engine-produced patch, appends an event with before/after, bumps `characters.revision`, writes a receipt, then emits SSE post-commit. Combat actions that touch attacker, target and encounter go through the encounter action coordinator.
5. **Content JSON is validated by `content-schema` before it is stored.** Unknown effect types, hooks, stat paths, or static effects using action-scoped predicates are hard errors, never warnings.
6. **Characters pin `content_versions`.** Published versions are immutable. Editing or deleting shared content must never change an existing sheet without the owner's consent.
7. **Automation levels are honest.** A feature is `full`, `partial` (with listed manual parts) or `manual`. Every `full`/`partial` feature needs a passing behavioural case. A manual placeholder is never evidence that a mechanic works.
8. **Rulesets never mix.** Characters, campaigns and content carry a `rulesetId`; validation refuses cross-ruleset references.
9. **No placeholder controls.** A button that does nothing does not ship. Prefer fewer working features.
10. **No unverified claims.** Report test commands and their actual output. If something was skipped or failed, say so.
11. **After Gate A1, architectural changes to the engine API, content schema or aggregate shape** require a `DECISIONS.md` entry, migrations with a migration test from the previous shape, green golden/conformance/E2E suites, and updated docs.
12. **Scope discipline.** Do not add infrastructure, dependencies or features beyond the approved plan unless a concrete implementation requirement justifies it; record the justification in `DECISIONS.md`.

## Milestone workflow

- Work one milestone at a time in the order of `docs/IMPLEMENTATION_PLAN.md`; keep the application runnable at every commit.
- Before starting: set the milestone to _in progress_ in the plan. On finishing: update status, criteria met, evidence (commands + results), what was skipped or is unsupported, and **measured usage** from the session usage tooling (record "not exposed" if unavailable; never estimate).
- Add tests with the feature, not afterwards. Golden cases live in `packages/rules-engine/test/golden/`; behavioural cases live next to the content overlay that declares the feature.
- Significant decisions go to `docs/DECISIONS.md` as a new ADR. Ambiguous rules go to the ambiguity register in `docs/RULES_ENGINE.md` with the assumption taken.
- Prefer focused changes over whole-file rewrites. Keep files single-purpose; split modules rather than growing them.

## How to add things

- **A new effect type:** add the Zod variant in `content-schema` (with scope and allowed targets/variables), implement its contribution or action behaviour in the engine, add unit tests and at least one golden case, regenerate `docs/EFFECTS_REFERENCE.md`, mention it in `RULES_ENGINE.md`.
- **New content:** author or convert into a package under `content/`, add mechanics overlays with `automation` and `tests[]`, run `import-content`, run the conformance suite, check `docs/AUTOMATION_COVERAGE.md`.
- **A new tRPC procedure:** schema in `schemas.ts`, policy action in `policy.ts`, service and repo with scope filtering, allow and deny cases in the authorization matrix test.

## Environment notes

- Development workstation is Windows 11 with Node 24, git and Docker Desktop (Linux engine). Development and tests use the embedded PostgreSQL 17 (spike S1); Docker is for image builds and the install smoke test (`deploy/docker/smoke-test.sh`).
- Production target is Unraid with the official `postgres:17` image. The image and install path are verified locally and in CI (`image` job); the repository is `https://github.com/justindgreen/scriptorium`.
- Licensing: SRD 5.1 is CC-BY-4.0; attribution text is stored with the source and shown in the app. Never import proprietary content or scrape D&D Beyond.
