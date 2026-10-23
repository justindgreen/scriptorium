# A1-R: Unraid rebuild and retest checklist

Scope: the five A1-R items approved on 2026-10-22 (`docs/A1_RECONCILIATION.md` §3, ADR-0039): #3 ability score methods, #5 language choices, #13 tracker conditions, #19 sheet links, #8 granted-spell automation. Nothing else changed in behaviour. Allow about 30 minutes.

## 1. Rebuild and update

1. Take a backup first (Admin → Backups → Backup now, or `scriptorium backup` in the container) and note the folder name.
2. Pull `main` at the A1-R commit named in the completion report and rebuild the image on the Unraid host (or your build machine) exactly as for the issue #2 hotfix:

   ```bash
   docker build -t scriptorium:latest -f deploy/docker/Dockerfile .
   ```

3. Restart the Scriptorium container. Migrations: none are added by A1-R; the start log should show no new migration and the usual idempotent content re-import.
4. Open the app on the plain-HTTP LAN address you normally use (the issue #2 regression spec stays in the suite) and confirm `/healthz` and `/readyz` answer.

## 2. Retest, item by item

Use two browsers or one normal and one private window: the DM account and a player account.

### #3 Ability score methods (builder)

- [ ] New character → Method **Standard array**: six dropdowns pre-filled with 15, 14, 13, 12, 10, 8. Pick a value already used by another ability: the two abilities swap; no value can appear twice; there is no empty option.
- [ ] Method **Point buy**: all six start at 8 and "27 of 27 points left" is shown. `+` on Strength seven times reaches 15 and the `+` disables; the counter shows 18 left; the per-step cost rises (1, 1, 1, 1, 1, 2, 2). Spend the rest; when 0 points are left every `+` whose step costs more than 0 is disabled; `−` refunds.
- [ ] Method **Rolled**: "Create character" is disabled until you press **Roll ability scores**. Six results appear with their four dice (`4d6kh3`); assign them with the dropdowns (swap semantics); create. The sheet shows exactly those six scores (add no species to see them without bonuses).
- [ ] Rolled scores cannot be substituted: with the browser's developer tools, re-send `characters.create` with `abilityMethod: "rolled"` and different `baseAbilities` → 400 "do not match the recorded roll"; without `abilityRollId` → 400 "must come from the server roll"; the same roll a second time → 412.
- [ ] Method **Manual**: plain number inputs 1–30.

### #5 Languages (sheet, pending choices)

- [ ] Build a Hill Dwarf Acolyte fighter. Under "Choices to make", the Acolyte **Languages** choice shows two dropdowns listing the standard and exotic languages plus "Other…". Known gap, not part of A1-R: the alpha species overlays keep languages as prose, so Common and Dwarvish are not granted as proficiencies yet and are therefore not disabled here nor listed on the sheet; languages you choose are.
- [ ] Pick Elvish in the first slot only and Save: the choice stays open with "choose 1 more", shows "Already chosen: Elvish", and Elvish is now disabled in the remaining slot.
- [ ] Pick Celestial and Save: the choice disappears.
- [ ] Reload: the **Proficiencies and languages** card lists Elvish and Celestial (and the armor, weapon and tool proficiencies; species languages: see the gap above).
- [ ] "Other…" accepts a custom language name and stores it as an id (e.g. "Thieves' Cant" → `thieves'-cant`; the engine accepts any id).

### #13 Conditions: sheet and tracker as one (campaign)

- [ ] DM: open an active encounter containing the player's character; the header badge reads **Live**. Player: open their sheet in the other browser; badge **Live**.
- [ ] Player applies **Blinded** on the sheet → the DM's tracker row shows the Blinded badge within a few seconds with no reload (the encounter's `version` in the page header does not change).
- [ ] DM presses **remove Blinded** in the tracker → the player's sheet drops the condition without a reload.
- [ ] DM applies a condition from the tracker's "+ condition" select → the sheet shows it; reload both pages: both still agree.
- [ ] Restart the Scriptorium container; reload both pages: the conditions still agree (they live only in the character record).
- [ ] Monsters still take conditions from the tracker as before.

### #19 Sheet links in the tracker

- [ ] Add a second player character (or the DM's own character) to the encounter. Player view: a **sheet** link on their own row only; none on the other characters or monsters. DM view: links on every character.
- [ ] Typing another character's sheet URL as the player still shows the "belongs to someone else" error (server enforcement is unchanged).

### #8 Honest automation for granted spells (homebrew)

- [ ] Homebrew → new item with a granted spell (the Fiendbane sword example): the validation badge reads **automation: partial** and the card lists "Manual parts: casting srd-5.1:spell:bless: it is listed under granted spells…". Remove the granted spell: back to **full** when only bonuses and the weapon block remain.
- [ ] The preview shows the grey informational line `PARTIAL_AUTOMATION: … listed under granted spells, but casting it from the sheet is not automated yet` and no `UNSUPPORTED_EFFECT` line.
- [ ] Give the published item to a character: the sheet's Spells card lists the granted spell with its charges; the Diagnostics card does not flag it as an error (info-level messages are not shown there).

## 3. Afterwards

- Record in the retest report which boxes passed, with the commit id and the image build date.
- If everything passes, A1 may be marked `verified` under the conditions of `docs/A1_RECONCILIATION.md` §7: the coverage exception stays recorded (ADR-0038) and the M3.2 remediation workstream stays first in Phase 3.
- If anything fails, open an issue per failure; A1-R is not closed by assigning a later milestone.

## 4. Addendum: issue #21, background chosen on the sheet

Rebuild exactly as in §1 at the commit named in the completion report (no migration is added; expect the usual idempotent content re-import on start).

- [ ] New character with Background left at "Choose later" (any class and species). The sheet header reads "Background: Not selected" and a **Background** card at the top says Not selected with a Choose background control.
- [ ] Choose **Acolyte**: the card shows Acolyte and "Feature: Shelter of the Faithful"; Skills shows Insight ● and Religion ●; "Choices to make" gains the Acolyte Languages choice with two slots; the Diagnostics card lists Shelter of the Faithful as a manual feature.
- [ ] Pick two languages and Save; the Proficiencies card lists them. Reload: background, skills and languages persist. Restart the Scriptorium container; reload: still there.
- [ ] Change the background (the SRD ships only Acolyte, so pick "None (remove the background)"): a red warning names the choices that will be reset ("Languages: …"), and nothing changes until you press **Confirm change**. After confirming: Not selected, the Acolyte skills, languages and feature are gone, the class skill choices remain, and the event log shows "Cleared background (reset 1 choice)".
- [ ] Choose Acolyte again: the Languages choice is open again with nothing pre-chosen.
- [ ] A character created with Acolyte in the builder is unchanged: its card shows Acolyte, its earlier language picks remain; pressing Change background with Acolyte still selected is disabled.
- [ ] As another player, the character's sheet is still not reachable; the API refuses `setBackground` for it (403).
