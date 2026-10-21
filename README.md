# Scriptorium

Self-hosted D&D 5e character, content and campaign platform: interactive character sheets with a deterministic rules engine, searchable compendiums, first-class homebrew, campaign management, monsters and encounters, and dice, with full local ownership of data. Runs on Unraid or any Docker host; works offline after install.

Status: foundation under construction. See `docs/IMPLEMENTATION_PLAN.md` for milestones and `CLAUDE.md` for the working rules.

## Development

Requirements: Node 24, pnpm (`npm install -g pnpm`).

```bash
pnpm install
pnpm dev          # web on http://localhost:5173, API on http://localhost:3000
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e     # builds the app and runs Playwright against the production-style server
```

## Documentation

- `docs/PRODUCT_SPEC.md` — requirements and release boundary
- `docs/ARCHITECTURE.md` — stack, layout, boundaries, deployment
- `docs/DATA_MODEL.md` — database schema
- `docs/RULES_ENGINE.md` — engine contract
- `docs/TEST_STRATEGY.md` — suites and gates
- `docs/DECISIONS.md` — decision records

## Licensing

Game content from the System Reference Document 5.1 is used under the Creative Commons Attribution 4.0 International License; attribution is shown inside the application. No proprietary content is bundled.
