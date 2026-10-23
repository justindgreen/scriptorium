# UX-1: Unraid rebuild and owner acceptance checklist

Scope: the UX-1 milestone approved on 2026-10-23 (`docs/A1_RECONCILIATION.md` §4, ADR-0041): #22 deletion, #6 confirmations, #15 level-up revert, #10 inactive effects, #14 new-tab links (checkpoint A), and #23 readable automation wording, #11 item details, #7 provenance, #9 target prompt, #4 sheet and builder layout (checkpoint B). Nothing in the rules engine's results changed. Allow about 45 minutes; do the sheet checks once on a desktop browser and once on a phone.

## 1. Rebuild and update

1. Take a backup (Admin → Backups → Backup now, or `scriptorium backup`).
2. Pull `main` at the commit named in the completion report and rebuild the image:

   ```bash
   docker build -t scriptorium:latest -f deploy/docker/Dockerfile .
   ```

3. Restart the Scriptorium container. No SQL migration is added; the content schema gains an optional `basedOn` field on items, which needs no data migration (existing items simply have none). The start log shows the usual idempotent content re-import.
4. Open the app on the LAN address you use; confirm `/healthz` and `/readyz` answer.

## 2. Checkpoint A: safety and clarity

### #4 Layout (read first, it frames the rest)

- [ ] A sheet with open choices shows **Needs your attention** at the top (missing background, missing class, choices to make), then **Play** (vitals, actions, resources, rests, spells) beside **Character** (conditions, background, proficiencies, coins), then **Equipment** across the page, then **Management** (level up, history, overrides, diagnostics, delete). On a phone the same sections stack in that order and the page never scrolls sideways.
- [ ] Errors appear in one place under the page header. "Why?" disclosures still open under each number.
- [ ] The builder's cards are numbered 1 · Basics, 2 · Ability scores, 3 · Create, and say that "Choose later" items are completed on the sheet.

### #6 Confirmations

- [ ] Damage the character, press **Long rest**: a prompt explains what will be restored and that it cannot be undone; **Cancel** leaves the hit points as they were; confirming restores them.
- [ ] **Add a level** opens "Add level N as <class>?" with a note that History can revert it right afterwards; Cancel adds nothing.

### #15 Revert a level-up

- [ ] Right after a level-up, Management → History shows **Revert the level-up (back to level N)**. Its prompt says it restores the complete previous state. Confirming returns the whole previous sheet as a new revision; the event log shows "Restored a snapshot" above the level-up; the button is gone afterwards; Undo stays disabled.
- [ ] Level up, then change anything else (a condition, a coin): the revert is no longer offered. The ordinary snapshot list in History still works.

### #10 Inactive effects

- [ ] Give the character an attunement item (the Fiendbane sword): equipped but not attuned, its row reads "effects inactive · requires attunement" with **Attune** right beside it; the attack line shows the base bonus. Attune: badge gone, bonuses applied. Non-attunement items show no Attune button.

### #22 Delete a character

- [ ] Management → **Delete character…**: the prompt names the character and says deletion hides it but keeps its history on the server with no restore button. The red button stays disabled until the exact name is typed; Cancel clears it.
- [ ] A character approved in a campaign: deletion is refused with "Cannot delete <name>: it is approved in the campaign "<name>" (withdraw it on the campaign page first)". On the campaign page the owner sees **Withdraw** (the DM sees **Remove from party**); it asks first and sets the row to "retired". Withdrawal is refused while the character is in a planned or active encounter ("the DM ends it first"); after the DM ends the encounter it works. Then deletion works and the character vanishes from the list; the finished encounter still opens and shows the row without a sheet link.
- [ ] A player cannot delete another player's character (403 in the network log); the DM cannot delete a player's character either.

### #14 Sheet links from the tracker

- [ ] In an encounter, the **sheet** link opens the sheet in a new tab; the tracker tab stays where it was.

## 3. Checkpoint B: items and wording

### #23 Readable automation wording

- [ ] Homebrew editor, Fiendbane with granted Bless: the Validation card reads "automation: partial" and "Partly automated. Still by hand: Bless is granted (1 charge), but casting it from this item is not automated yet". No `srd-5.1:spell:bless`, no `PARTIAL_AUTOMATION` in the editor or the preview; codes sit under **Diagnostic details** in the preview.
- [ ] On the sheet, the granted spell still lists as "Bless · granted by <item> · 1 charge".

### #7 Provenance

- [ ] Start a weapon from an SRD weapon (search "longsword", pick it): the editor shows "Based on Longsword (SRD 5.1, version 1). The stats were copied once; later changes to the original do not flow in." Save, reload: still shown. **Forget the link** removes it.
- [ ] After giving the item to a character, the item's Details on the sheet show "Based on Longsword (… ) · copied once, not linked".

### #9 Target prompt

- [ ] Preview of an item with conditional damage, target "unknown type": a highlighted question asks for the creature type and the plan line reads "Plan without the conditional damage: …". Choosing "fiend" removes the question and the plan includes the radiant dice.

### #11 Item details

- [ ] Each inventory row has a **Details** disclosure: description, type and rarity, weapon or armor numbers, charges, effects as sentences (for example "+3 to attack rolls with this weapon", "1d8 extra radiant damage against fiend or undead", "grants Bless (1 charge); casting it from the sheet is not automated yet"), current inactive state if any, provenance, source and version.

## 4. Afterwards

- Record which boxes passed on desktop and on the phone, with the commit id and image build date.
- Issues #22, #23, #6, #7, #9, #10, #11, #14 and #15 are closed by your confirmation, not by the push; #4's first pass is accepted the same way (UX-2 carries the rest of #4 and #14).
- Nothing here changes the A1 decision, ADR-0038 or the M3.2 commitments.
