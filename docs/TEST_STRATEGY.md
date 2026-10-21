# Test Strategy

Testing is part of implementation. A milestone is done only when its tests exist, pass, and the report shows the commands and results.

## 1. Suites

| Suite                    | Tool                                                           | Scope                                                                                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                     | Vitest                                                         | resolver phases, cycle detection, each effect type (static and action), predicates incl. tri-state, formulas, dice ast/roll, point-buy, policy decisions, schemas, command patches and compensations                       |
| Golden regression        | Vitest + JSON fixtures in `packages/rules-engine/test/golden/` | character aggregates with expected sheet slices, expected action plans for given contexts, expected command results. 2014 SRD rules are the source of expected values; ambiguities go to the register in `RULES_ENGINE.md` |
| Conformance and coverage | Vitest runner over content packages                            | declaration checks and behavioural cases per feature; generates `docs/AUTOMATION_COVERAGE.md`                                                                                                                              |
| Property                 | fast-check                                                     | dice grammar, point-buy, resolver invariants (order independence, add commutativity, replace determinism)                                                                                                                  |
| Integration              | Vitest against the dev database; CI also against `postgres:17` | modules, migrations from empty, JSON migrators, import/export round trips, authorization matrix, combat coordination, restore acceptance                                                                                   |
| E2E                      | Playwright + axe-core                                          | the acceptance scenario on alpha content (gate A1) and full content (1.0), desktop and mobile; theme and reduced motion                                                                                                    |

## 2. Golden case format

```json
{
  "name": "rogue-5-sneak-attack-once-per-turn",
  "ruleset": "srd5.1-2014",
  "aggregate": { "...": "definition, inventory, state" },
  "snapshotRefs": ["srd-5.1:class:rogue@1", "..."],
  "expectSheet": { "skill.stealth.bonus": 9, "attacks.perAction": 1 },
  "actions": [
    {
      "ref": { "kind": "weapon", "itemId": "rapier" },
      "ctx": { "situation": { "advantageSources": ["hidden"] } },
      "expectPlan": {
        "damagePackets": [
          { "type": "piercing", "dice": "1d8+4" },
          { "type": "piercing", "dice": "3d6", "source": "Sneak Attack" }
        ]
      }
    }
  ],
  "commands": [
    {
      "command": { "type": "applyDamage", "amount": 12, "damageType": "slashing" },
      "expectState": { "hp_current": 20 }
    }
  ]
}
```

## 3. Behavioural case format (in mechanics overlays)

Every `full` or `partial` feature declares `tests[]`:

```json
{
  "given": { "fixture": "fighter-5-champion", "modify": { "state.combat.turn.ownTurn": true } },
  "expect": { "stat": "crit.range", "equals": 19 }
}
```

`expect` is one of `{ stat, equals | atLeast | contains }`, `{ actionPlan: { ref, ctx }, contains | excludes }`, `{ command, expectState | expectError }`. The conformance runner executes these through the real engine. A feature is **verified** only when all its cases pass; a feature with mechanics but no case is **unverified**.

## 4. Conformance requirements

**Gate A1 (alpha content):** every numeric or resource-bearing feature is `full`; 100% of `full`/`partial` features verified by behavioural cases; every `manual` feature on the allow-list; ≥ 95% of alpha class and subclass features `full` or `partial`; all four alpha classes compute at levels 1–20 with no engine errors and no hooks outside the registry; golden sheets at L1/5/11/13/15/17/20 per class and for both multiclass builds, exercising 6th–9th-level slots, preparation counts and Mystic Arcanum.

**1.0 (full SRD content):** (a) every numeric or resource-bearing feature is `full` (ability increases, proficiencies, AC formulas, HP, slots, resources, attack and damage bonuses, Extra Attack, Expertise, Jack of All Trades, Sneak Attack, Rage, Unarmored Defense, fighting styles' numeric parts, Channel Divinity and Ki pools, invocation numeric effects); (b) ≥ 90% of SRD class and subclass features `full` or `partial`; (c) ≥ 95% of SRD species traits and ≥ 90% of SRD magic items with mechanical text `full`; (d) every `manual` feature in official content on the owner-reviewed allow-list; (e) all twelve SRD classes compute at every level 1–20 with no engine errors and no hooks outside the registry; (f) 100% of `full`/`partial` features verified.

## 5. Integration specifics

- **Authorization matrix:** a table of (role, procedure, expected allow/deny); a meta-test enumerates every procedure and fails if one lacks both an allow and a deny case.
- **Combat coordination:** the same `commandId` twice applies once; a roll cannot be consumed by two commands; target revision mismatch rolls back the attacker; concurrent actions do not deadlock (deterministic lock order).
- **Turn bookkeeping:** once-per-turn resets on another creature's turn; reaction resets only on the owner's turn; bonus action unavailable off-turn.
- **Content stability:** publishing a new version or deleting shared content never changes an existing sheet without consent.
- **Round trips:** export → import → export is byte-stable for content packages, characters and campaigns.
- **Restore acceptance:** seed instance A (users, content, uploaded portrait, later a character); `backup`; start a fresh instance B (empty database and data directory); `restore`; then on B: the restored user logs in, content counts match, the portrait is served with the same sha256, and a character's `ComputedSheet` JSON is identical to A's. Runs in M1.6, Gate A1, M6.3 (from a backup taken by the previous released version) and CI, using two databases on one Postgres service and two data directories.
- **Migrations:** apply all from empty; after Gate A1, every schema change ships a test that migrates a fixture of the previous shape.

## 6. E2E

The acceptance scenario in `PRODUCT_SPEC.md` §16 is a Playwright test with a server restart in the middle of the encounter and a retried attack command that must apply once. It runs at 1280 px and 375 px. axe-core checks run on every visited page.

## 7. Running (commands land with M1.1)

```bash
pnpm test                 # unit, golden, property, conformance
pnpm test:integration     # needs the dev database
pnpm test:e2e             # Playwright
pnpm coverage:automation  # regenerates docs/AUTOMATION_COVERAGE.md
```
