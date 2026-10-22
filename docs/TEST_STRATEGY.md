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

Cases live in `packages/rules-engine/test/golden/*.json`; files starting with `_` hold shared inline content (overlays). The runner (`golden.test.ts`) builds the snapshot from `snapshotRefs` (uids resolved from the committed SRD packages), `contentFiles` and inline `content` (inline entries override SRD entries with the same uid, exactly like mechanics overlays, and must pass the content schema), fills the aggregate with `createAggregate`, computes the sheet, checks every expectation, recomputes to prove determinism and recomputes with the inventory and temporary effects reversed to prove independence from storage order. `variants` deep-merge a patch into the aggregate (objects merge, arrays replace) and carry their own expectations. Action plans and spellcasting views are checked by `golden-actions.test.ts` from the same files: `actions: [{ name, ref, ctx?, expectPlan: { attack, damage[], damageIds, excluded, questions, assumptions, oncePerTurnKeys, costs, blocked, healing, save, concentration, economy }, rolls?, targetAc?, expectOutcome: { hit, critical, packets, oncePerTurnMarks, economyMark, healing } }]` and `expectSpellcasting: null | { casterLevel, slots, pact, sources[], knownUids, alwaysPreparedUids, preparedCount, blocked }`, on the base case or on a variant. Commands join the format in M2.5.

```json
{
  "name": "fighter-1-human-chain-mail",
  "ruleset": "srd5.1-2014",
  "snapshotRefs": ["srd-5.1:class:fighter", "srd-5.1:item:chain-mail"],
  "contentFiles": ["_overlays.json"],
  "content": [],
  "aggregate": {
    "definition": { "...": "classes, choices, abilities" },
    "inventory": [],
    "state": {}
  },
  "expectSheet": {
    "ac.total": 19,
    "skill.stealth.bonus": 2,
    "roll.disadvantage.check.stealth": true
  },
  "expectError": { "ability.str.score": true },
  "expectOverride": { "ac.total": { "auto": 10, "manual": 20 } },
  "expectBreakdown": { "ac.base": { "applied": ["Mage Armor"], "lost": ["Unarmored"] } },
  "expectDiagnostics": [{ "code": "CYCLE_DETECTED", "statPath": "ability.str.score" }],
  "expectNoDiagnostics": ["MISSING_CONTENT"],
  "expectPendingChoices": [
    { "key": "class:srd-5.1:class:fighter@1/skills", "remaining": 2, "options": 8 }
  ],
  "expectProficiencies": { "armor": ["all-armor", "shields"] },
  "expectTemplates": [{ "name": "Longsword", "attackBonus": 5, "damage": ["1d8 + 3 slashing"] }],
  "expectResources": [{ "id": "second-wind", "max": 1 }],
  "expectDefenses": [{ "kind": "resistance", "damageType": "poison" }],
  "expectToggles": [{ "id": "rage", "active": true }],
  "expectHitDice": [{ "die": "d10", "max": 1 }],
  "expectFeatures": ["srd-5.1:feature:second-wind"],
  "variants": [
    {
      "name": "without a shield",
      "aggregate": { "inventory": [] },
      "expectSheet": { "ac.total": 16 }
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

`expect` is one of `{ stat, equals | atLeast | contains }` (a boolean stat that was never set counts as `false`), `{ actionPlan: { ref, ctx }, contains | excludes }` (matched against the plan summary: `actionType`, `blocked`, `damageIds`, `damage[]`, `excluded`, `questions`, `oncePerTurnKeys`, `costs`, `riders`, `economy`, `attack`, `save`, `check`, `healing`, `concentration`; `contains` is a deep subset where each expected array element must match some actual element, `excludes` the opposite), `{ proficient: { set, id } }`, `{ knownSpell }`, `{ defense: { kind, damageType } }` or `{ command, expectState | expectError }` (executed from M2.5). `given.modify` is deep-merged into the fixture (objects merge, arrays replace). The conformance runner (`tools/conformance`, `pnpm coverage:automation`, and its Vitest suite) executes these through the real engine. A feature is **verified** only when all its cases pass; a feature with mechanics but no case is **unverified**, except entries whose mechanics are structured data with no effects (weapons, armor, classes, spells, monsters), which the schema and the engine's direct reading of that data verify.

## 4. Conformance requirements

**Gate A1 (alpha content):** every numeric or resource-bearing feature is `full`; 100% of `full`/`partial` features verified by behavioural cases; every `manual` feature on the allow-list; ≥ 95% of alpha class and subclass features `full` or `partial`; all four alpha classes compute at levels 1–20 with no engine errors and no hooks outside the registry; golden sheets at L1/5/11/13/15/17/20 per class and for both multiclass builds, exercising 6th–9th-level slots, preparation counts and Mystic Arcanum. **Status at M2.4:** all criteria hold except the 95% share: 63.1% of the 149 alpha class and subclass feature rows are `full` or `partial`, 81.7% of the 115 rows that are not SRD table placeholders (archetype-selection rows, "improvement" rows, "domain spells" rows, use-count duplicates, destroy-undead thresholds, tagged `placeholder`). The remaining manual features are narrative or table-adjudicated (Evasion, Reliable Talent, Elusive, Survivor, Disciple of Life, eight invocations, …) and sit on the allow-list with reasons. The conformance test records 78% as the regression floor; whether the gate is re-based to mechanical rows, lowered, or held is the owner's decision at Gate A1.

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

Server restarts in E2E (M2.6): `e2e/start-server.mjs` supervises the server process and restarts it when a test creates `restart.request` in the E2E data directory; the application has no test hooks. Specs that restart the server run in the `restart` Playwright project, which depends on the desktop, tablet and phone projects so nothing else is in flight while the server is down. Readiness after the restart is detected through `/healthz` (a lower uptime) and `/readyz`.

## 7. Running (commands land with M1.1)

```bash
pnpm test                 # unit, golden, property, conformance
pnpm test:integration     # needs the dev database
pnpm test:e2e             # Playwright
pnpm coverage:automation  # regenerates docs/AUTOMATION_COVERAGE.md
```
