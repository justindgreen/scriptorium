# Licences

## Game content

**System Reference Document 5.1.** This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

The attribution text is stored with the source (`content_sources.attribution_text`), shown on the application's `/licenses` page (public, no sign-in needed) and embedded in exports.

**Conversion input.** Structured SRD data is converted from the 5e-bits/5e-database project (https://github.com/5e-bits/5e-database), whose code and data files are MIT licensed. The converter verifies the upstream LICENSE before running. Mechanics overlays (effects, choices, tests) are authored in this repository.

Scriptorium bundles no other game content. Users add content they own through the editors or by importing packages (docs/CONTENT_FORMAT.md). The application never scrapes D&D Beyond or any other service.

## Software bundled in the web app

- Fraunces (SIL Open Font License 1.1), Inter (SIL Open Font License 1.1), via `@fontsource-variable`.
- Lucide icons (ISC).
- Components generated with the shadcn CLI (MIT) on Radix UI primitives (MIT).

Third-party npm dependencies carry their own licences; `pnpm licenses list` enumerates them.
