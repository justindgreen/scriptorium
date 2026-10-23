/**
 * The 2014 standard and exotic languages (SRD 5.1, CC-BY-4.0), as the ids the engine's
 * `language.grant` effects use. The engine accepts any language id for a free language choice;
 * this list only feeds the picker, which also offers "Other…" for a custom one (issue #5).
 */
export const LANGUAGES: ReadonlyArray<{ id: string; name: string; exotic?: boolean }> = [
  { id: 'common', name: 'Common' },
  { id: 'dwarvish', name: 'Dwarvish' },
  { id: 'elvish', name: 'Elvish' },
  { id: 'giant', name: 'Giant' },
  { id: 'gnomish', name: 'Gnomish' },
  { id: 'goblin', name: 'Goblin' },
  { id: 'halfling', name: 'Halfling' },
  { id: 'orc', name: 'Orc' },
  { id: 'abyssal', name: 'Abyssal', exotic: true },
  { id: 'celestial', name: 'Celestial', exotic: true },
  { id: 'draconic', name: 'Draconic', exotic: true },
  { id: 'deep-speech', name: 'Deep Speech', exotic: true },
  { id: 'infernal', name: 'Infernal', exotic: true },
  { id: 'primordial', name: 'Primordial', exotic: true },
  { id: 'sylvan', name: 'Sylvan', exotic: true },
  { id: 'undercommon', name: 'Undercommon', exotic: true },
]

/** `Deep Speech` -> `deep-speech`: the id form the engine stores. */
export function languageId(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}
