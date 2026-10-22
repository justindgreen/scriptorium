# Content Format

Portable, versioned JSON for everything the compendium holds. Schemas live in `packages/content-schema`; this document is the human-readable contract. The format is designed so privately owned content can be added without touching application code, and so homebrew round-trips between instances.

## Package: `scriptorium-content-package` version 1

```json
{
  "format": "scriptorium-content-package",
  "formatVersion": 1,
  "source": {
    "slug": "my-sourcebook",
    "name": "My Sourcebook",
    "kind": "homebrew",
    "license": "All rights reserved",
    "attributionText": "Shown on the licences page.",
    "version": "1.0.0",
    "publisher": "Optional",
    "url": "https://optional.example"
  },
  "rulesetId": "srd5.1-2014",
  "entries": [ ... ]
}
```

- `source.slug` identifies the collection; re-importing the same slug updates it in place.
- `source.kind` is `srd`, `user_import` (licensed content the user owns) or `homebrew`.
- Every entry's `uid` must begin with `<source.slug>:`.

## Entry

```json
{
  "kind": "spell",
  "uid": "my-sourcebook:spell:glimmer",
  "slug": "glimmer",
  "name": "Glimmer",
  "data": { ...kind-specific fields... },
  "effects": [ ...static and action effects... ],
  "choices": [ ...choice points... ],
  "automation": { "level": "full" },
  "tests": [ ...behavioural cases... ],
  "tags": ["cantrip"],
  "relations": [{ "to": "my-sourcebook:class:wizard", "relation": "list_member" }],
  "reference": "p. 12"
}
```

- `uid` is `<source>:<kind>:<slug>` and is the stable identity across versions, instances and exports.
- Kinds: `class, subclass, species, background, feat, feature, spell, spell_list, item, monster, condition, rule, resource`. The `data` shape per kind is defined in `content-schema/src/kinds.ts`; unknown fields are rejected so typos never pass silently.
- `effects` and `choices` carry mechanics (docs/RULES_ENGINE.md §4–5). Static effects may only use static predicates; `action.*` effects may use action predicates; defenses may use packet predicates.
- `automation.level` is `full`, `partial` (with `manualParts`), `manual`, or `pending` (imported skeleton whose mechanics are not authored yet). `full`/`partial` require mechanical effects, choices, or structured weapon/armor/charges data; `full` cannot include `manual` effects.
- `tests` are behavioural cases run by the conformance suite (docs/TEST_STRATEGY.md §3).
- Relations are stored by target uid so they may point at entries imported later. Implied relations are added on import: subclass → class (`subclass_of`), species → parent (`variant_of`), species → traits and spell lists → spells (`grants`), spell → class (`list_member`), feature → owner (`owner_of`), item → variant base (`variant_of`), class → features (`grants`).

## Import semantics

1. The whole package is validated; any issue aborts the import and is reported with its JSON path.
2. The package's `rulesetId` must already exist (rulesets are imported from `content/rulesets/*.json` or with the CLI).
3. The source is created or updated by slug.
4. For each entry, a checksum of `data, effects, choices, automation, tests, tags, relations, name, reference` (sorted keys) is compared with the current head version. Unchanged entries are skipped; changed entries get a new immutable `content_versions` row and the head pointer moves; new entries are created. Previous versions are never modified or deleted.
5. Tags, relations and the search projections (`spell_index`, `item_index`, `monster_index`) are rebuilt for touched entries.

Characters pin version ids, so re-importing a package never changes an existing sheet (docs/ARCHITECTURE.md, ADR-0011).

## Commands

```bash
pnpm -F @scriptorium/server cli -- import-content <file.package.json|ruleset.json>...
pnpm -F @scriptorium/server cli -- seed [dir]      # bundled content (also runs at server start)
pnpm -F @scriptorium/server cli -- sources         # installed sources with entry counts
```

Administrators can also import a package through the API (`content.importPackage`); the web upload UI arrives with the homebrew milestones.

## Ruleset configuration

`content/rulesets/<id>.json` validated by `rulesetConfigSchema`: ability and skill lists, proficiency bonus and XP tables, spell slot tables (full, half, third, pact, multiclass), point-buy costs, standard array, encounter thresholds and multipliers, rest rules, carrying capacity, condition uids, exhaustion levels, damage types. Tables are arrays indexed by level - 1 and may extend past `maxLevel`.

## Bundled SRD 5.1 packages

`content/srd-5.1/*.package.json` are generated, not hand-edited:

```bash
pnpm -F @scriptorium/srd-import download -- --out <isolated dir>
pnpm -F @scriptorium/srd-import convert -- --source <isolated dir> --out content/srd-5.1
```

The converter reads the upstream 5e-bits dataset (downloaded data, parsed as JSON only, MIT licensed; the SRD text itself is CC-BY-4.0), merges mechanics overlays from `content/srd-5.1/mechanics/*.json` (arrays of `{ uid, effects?, choices?, automation?, tests?, tags?, data? }`; `data` is a shallow patch onto the entry's data, used for charges and for the weapon stats of a specific magic weapon such as the Mace of Disruption; files whose elements carry none of those fields, such as `alpha.json` and `manual-allowlist.json`, are not overlays), generates concrete `+1`/`+2`/`+3` variants of every mundane weapon and armor (`<slug>-<n>`, e.g. `srd-5.1:item:longsword-1`, with the enhancement as `attack.weapon.self`/`damage.weapon.self` or `ac.bonus` effects, `variantOf` the generic SRD entry, and a behavioural case each on the `item-bench` fixture), validates every package and writes it. Entries without an overlay that need mechanics are marked `automation: pending`. Behavioural-case fixtures (character aggregates) live in `content/srd-5.1/mechanics/fixtures/*.json`; `alpha.json` names the alpha content set and `manual-allowlist.json` records every manual alpha feature with its reason. The alpha overlays and fixtures are generated by `pnpm -F @scriptorium/srd-import generate-overlays` (`tools/srd-import/scripts/generate-alpha-overlays.mjs`); edit the generator, regenerate, then re-run `convert`. The committed JSON is what ships. Known limitation: the upstream dataset has no class description prose, so class entries carry a minimal description and the text lives on their features.
