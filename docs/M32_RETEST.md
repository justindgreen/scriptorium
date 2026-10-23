# M3.2 remediation: Unraid rebuild and owner retest checklists

One section per checkpoint. Nothing here changes the A1 decision, ADR-0038 or the coverage accounting; the alpha class-feature figures stay 63.1% / 81.7% / 89.5% until the feature checkpoints land.

## Checkpoint 1: D-1 spell damage

### Rebuild

1. Take a backup (Admin → Backups → Backup now, or `scriptorium backup`).
2. Pull `main` at the commit named in the completion report and rebuild the image:

   ```bash
   docker build -t scriptorium:latest -f deploy/docker/Dockerfile .
   ```

3. Restart the Scriptorium container. No SQL migration. The bundled SRD spells package changed (64 spells now carry typed damage dice; 66 carry an automation level), so the start log shows the content re-import writing new versions for those entries. Characters keep the versions they pinned until they next change a spell-related choice; a freshly built character uses the new ones.

### Retest, about 20 minutes

- [ ] **Sheet cast, cantrip.** New Cleric (any species, Acolyte). Spells → "Add a spell" → search "sacred" → Sacred Flame. Press Cast: the card reads "Save DEX DC 13" (Wisdom 16) and "1d8 radiant"; Roll shows a d8 result; Apply logs "Sacred Flame" and spends no slot.
- [ ] **Sheet cast, leveled and upcast.** Add Guiding Bolt (prepared). Cast with a level 1 slot: "+5 to hit", "4d6 radiant", slot cost shown; after Apply the level-1 slots read 1 used. On a level-3 cleric cast it with a level 2 slot: "5d6 radiant" and a level-2 slot spent. A slot the character does not have is refused ("not enough level N spell slots"), never cast lower.
- [ ] **Healing unchanged.** Cure Wounds still heals 1d8 + modifier.
- [ ] **Cantrip scaling.** On a level-5 cleric Sacred Flame reads 2d8 (3d8 at 11, 4d8 at 17).
- [ ] **Two damage types.** On a level-9 cleric Flame Strike (level 5 slot) shows two packets, 4d6 fire and 4d6 radiant, with a DEX save, half on a success.
- [ ] **Encounter, save spell.** In an active encounter the DM's action picker lists the cleric's damage cantrips and prepared damage spells, for example "Sacred Flame (cantrip, DEX save DC 13, radiant)". Plan it at a skeleton: the plan line shows the save; tick "The target succeeded on its saving throw" and apply: the log says "DEX save DC 13 succeeded (no damage)" and the skeleton's hit points do not move. Roll again without the tick: "failed" and the damage lands. For Fireball at level 5, a successful save halves the damage, rounded down.
- [ ] **Retry safety.** Apply the same cast twice (the second press after a network hiccup, or re-send the request): the second is replayed, the slot is spent once and the damage lands once.
- [ ] **Honest limits.** Hover or read the spell's automation: damage spells are `partial` and name what stays manual (choosing every creature in an area, extra darts or rays from a higher slot, later-turn damage, conditions). Sleep and Prismatic Spray are `manual` and plan no damage. Spells without damage data (Bless, Shield, Mage Armor…) plan the slot cost only, as before.
- [ ] **Resistances still apply.** A skeleton takes full radiant damage; a creature resistant to fire takes half of Fire Bolt (set up a resistance with a monster that has one, for example a fire-resistant creature from the compendium when available).

### Known D-1 limits (recorded, not hidden)

- One target per cast through the coordinator; area spells are applied to each creature in turn by the DM.
- Extra darts, rays or beams from a higher slot (Magic Missile, Scorching Ray, Eldritch Blast's extra beams, Chain Lightning's extra targets) are repeats of the single packet, chosen by the table.
- Recurring damage (Flaming Sphere, Call Lightning, Moonbeam and similar), conditions, movement and other text effects stay manual.
- Monsters' own spells are not cast through the coordinator (M5.3).
