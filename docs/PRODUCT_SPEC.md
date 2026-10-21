# Product Specification

Scriptorium is a self-hosted web application for Dungeons & Dragons 5th Edition that gives a Dungeon Master and their players interactive character creation and sheets, automated rules, searchable compendiums, first-class homebrew, campaign management, monsters and encounters, and dice rolling, with full local ownership of data. It provides capability comparable to D&D Beyond with its own identity, architecture and implementation. It does not reproduce D&D Beyond's interface, branding or proprietary content.

This document restates the owner's specification as product requirements, fixes the boundary of the initial playable release (1.0), and records the acceptance scenario. Architecture lives in `ARCHITECTURE.md`; sequencing lives in `IMPLEMENTATION_PLAN.md`.

## 1. Design principles

1. Local-first ownership of data.
2. Full self-hosting with no mandatory external services; all core functionality works offline after installation and content provisioning.
3. A rules-driven, data-defined character system rather than hardcoded classes and features.
4. Homebrew as a first-class feature using the same schema as official content.
5. Clear separation of game content, game mechanics, runtime state and presentation.
6. Fast, approachable interfaces for players and DMs on desktop, tablet and phone.
7. Extensible architecture that absorbs new rulesets, classes and homebrew without rewrites.
8. Secure multi-user operation with authorization enforced on the server.
9. Persistent storage with reliable migrations and backups.
10. Maintainable, tested, documented code.

## 2. Hosting and deployment requirements

- Runs on an Unraid server as Docker containers with persistent volumes under appdata; also runs on any Docker host.
- PostgreSQL 17 as the database (16 tolerated with a warning).
- Local network access by default; optional reverse proxy with HTTPS.
- Environment-variable configuration; restart-safe; migrations applied automatically at start.
- Deliverables: production Dockerfile, Docker Compose for development-parity deployments, an Unraid Community Applications template that does not require Compose, persistent data mappings, migration procedure, backup/verify/restore commands and documentation, health endpoints, installation guide.
- No SaaS authentication, hosted databases or external AI services.

## 3. Rulesets

- D&D 5e 2014 rules (SRD 5.1) are the initial and default ruleset.
- The architecture supports additional rulesets, including the 2024 revision (SRD 5.2.1), without replacing or corrupting existing characters.
- Characters, campaigns and content records identify their ruleset explicitly. 2014 and 2024 mechanics are never silently combined.

## 4. Rules engine requirements

The engine is deterministic and testable and is responsible for ability scores and modifiers, proficiency bonus, saving throws, skills with proficiency and expertise, armor class, initiative, movement, hit points and hit dice, attack and damage modifiers, weapon and armor proficiency, spellcasting ability, save DC and spell attack, spell slots and preparation limits, class and subclass features, multiclassing, feats, conditions, temporary and permanent bonuses, short and long rests, and resource consumption and recovery.

- It distinguishes base values, calculated modifiers, temporary effects and manual overrides, and every calculated value is explainable by its contributing sources.
- Mechanics are represented as structured, validated data (for example +2 Dexterity, advantage on specific saves, extra spell slots, resistances, extra attacks, expanded critical range, speed increases, class resources, charges that recharge at dawn, spells granted by equipment, bonuses conditional on creature type).
- The modifier system supports conditions, priorities, stacking rules, prerequisites and temporary effects.
- Mechanics that depend on a specific attack, target, turn or situation are resolved contextually at action time, not forced into the static sheet.
- Where a mechanic cannot be represented declaratively, the engine offers controlled extension points, never arbitrary user code.
- Unrecognized or unsupported mechanics never produce silently incorrect results; they are rejected at validation or surfaced as manual.
- Sheet computation never involves randomness; dice are evaluated only through explicit roll steps or supplied results.

## 5. Character builder and sheet

Builder: identity, portrait and biography; ability scores by standard array, point buy or manual entry; species; class and subclass; background; skills and tools; equipment; starting spells; feats; multiclassing; level progression; HP by fixed value, rolling or manual entry; optional features; custom starting level; manual adjustments. Available choices update dynamically from prerequisites and prior selections.

Sheet: overview, ability scores, saving throws, skills, combat statistics, attacks and actions, features and traits, inventory and currency, equipment and attunement, spellcasting, conditions, limited-use resources, notes and biography. Direct interaction: roll checks, saves and attacks; apply damage and healing; spend slots; use features; take rests; equip, unequip and attune; update currency; apply and remove conditions. All actions persist. Manual overrides are supported with restore to the computed value. Usable on desktop, tablet and phone.

## 6. Compendium

Searchable library of rules, classes, subclasses, species, backgrounds, feats, spells, equipment, magic items, monsters, conditions and optional rules, with categorized browsing, filtering, full-text search and detail pages. Content carries structured mechanics as well as text.

Content and licensing: SRD 5.1 content under CC-BY-4.0 with the required attribution preserved and license and source tracked per record. Users with rights to other content add it through editors or import packages. No scraping, no bypassing access controls, no bundling of unauthorized content. The platform is useful with only the SRD and homebrew installed.

Source management: content records identify source collection and version; collections can be enabled or disabled; visibility controls; source filtering; versioning; import conflict and duplicate detection; custom sourcebooks; campaign-specific availability.

## 7. Homebrew

Creation tools for classes, subclasses, species, backgrounds, feats, spells, magic items, weapons, armor, monsters, NPCs, rules features and custom resources, using structured forms for mechanics plus an advanced structured editor. Creators define prerequisites, level requirements, proficiencies, ability modifiers, actions and attacks, passive and conditional effects, resource pools and charges, recharge rules, spellcasting effects, damage formulas, saving throws, scaling and level-based progression. Custom content references other content and integrates with the sheet.

Management: drafts, validation, previews, version history, duplication, editing, publishing, campaign-level sharing, creator attribution, private and shared content, portable JSON import/export, and safe migration when published homebrew changes. Existing characters never break when shared content is edited or removed. The architecture allows progression beyond level 20 later.

## 8. Campaigns

Multiple campaigns with distinct players, characters, settings and content. DM and player roles. A DM can create campaigns, invite players, assign or approve characters, view party characters, manage campaign homebrew, share content, keep notes, manage NPCs, organize encounters, award XP or milestone levels, grant items, and review or adjust characters when authorized. Player-facing and DM-only information are separated and a player can never retrieve hidden encounters, private notes, unrevealed monster information or other players' protected data through the API.

## 9. Monsters and encounters

Monster and NPC compendium with searchable stat blocks; custom monsters and modified stat blocks. Encounter manager with naming and organization, monster selection, multiple instances, ruleset-based difficulty estimates with custom adjustment, notes, initiative, HP, conditions, concentration reminders, round and turn management, monster actions, dice rolling, private DM information. Combat state survives refreshes and restarts. A virtual tabletop is out of scope.

## 10. Dice

A reusable engine for polyhedral dice, compound expressions, modifiers, advantage and disadvantage, critical hits, attack, damage, save, check and healing rolls, and custom formulas, accessible from sheets and encounters, showing components and totals. Private DM rolls and optional campaign roll history. Expressions are validated and parsed, never evaluated as code.

## 11. User experience

A polished product with an original identity for tabletop play: clean hierarchy, fast navigation, high readability, attractive sheets, responsive layouts, accessible controls, consistent components, helpful empty states, inline validation, clear loading and error states, light and dark themes, reduced motion, keyboard access. No decorative controls that do nothing.

## 12. Authentication, security and integrity

Local accounts with role-based authorization; an initial administrator created at setup; secure password hashing; safe sessions; authorization on every protected operation; input validation; injection and XSS protection; safe rendering of user content; safe upload handling; transactional updates; rate limiting on sensitive endpoints; audit logs for administrative actions; database backup and restore.

## 13. Import, export and portability

Structured JSON export for characters, homebrew, monsters, campaigns and content collections; import with validation, error reporting and conflict handling; printable sheets and PDF export; a documented import API that can later accept spreadsheets and CSV. No assumptions about proprietary third-party formats.

## 14. What we do not want

A nonfunctional prototype; mock data presented as a backend; hardcoded sheet values; an engine limited to a couple of classes; rules duplicated in components; text-only homebrew; a schema capped at level 20; cloud dependencies; unauthorized content; copying D&D Beyond; sprawling files; microservices; unverified claims of success; silent rule changes.

## 15. Initial playable release (1.0) boundary

**In 1.0:** local auth and admin; SRD 5.1 content with full mechanics coverage per the conformance thresholds in `TEST_STRATEGY.md`; the 2014 engine for all SRD classes, subclasses, species, backgrounds, feats and items; builder, level-up and multiclassing; the full interactive sheet with persistence, events, undo and snapshots; print stylesheet; compendium with search and source control; homebrew editors for weapon/armor/item, feat, spell, species, background, condition/feature/resource, monster/NPC and (sequenced last) class/subclass; versioning, sharing, import/export; campaigns with invites, roles, approvals, DM sheet access, awards, notes, NPCs and roll log; monsters, encounter builder with 2014 difficulty, live combat tracker with persistence and player view; Docker, Compose, Unraid template, backup/restore, documentation.

**After 1.0 (architecture already accommodates):** the 2024 ruleset (SRD 5.2.1); server-side PDF; structured spell self-effects applied on cast; Wild Shape and Polymorph forms; companion and familiar sheets; progression beyond level 20 in the UI; cross-ruleset allowances per campaign; passkeys, 2FA, OIDC; CSV and spreadsheet importers; maps and VTT; chat; localization.

**Alpha (internal gate A1, not a release):** the acceptance scenario proven on a deliberately hard subset of content (Fighter/Champion, Rogue/Thief, Cleric/Life, Warlock/Fiend at levels 1–20, two multiclass builds, three species, Acolyte, Grappler, curated items, all SRD spells as metadata, 12 monsters) before content breadth is authored.

## 16. Acceptance scenario

A DM installs the application, creates a local account, creates a campaign, invites a player, and makes SRD content available. The player creates a valid first-level 2014 character, selects class features and equipment, saves the character, rolls checks, changes hit points, and uses the sheet. The player levels the character and statistics update correctly. The DM creates a homebrew magic item with an automatic modifier and limited-use charges, assigns it to the character, and sees its mechanics on the sheet. The DM creates an encounter, adds monsters, and tracks initiative and hit points. All data survives application and database restarts.

This scenario is an automated end-to-end test. It must pass on alpha content at gate A1 and on full content at 1.0.
