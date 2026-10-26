# DESIGN.md

Design direction for the participant and admin UI. Transcribed from the project
owner's answers on 2026-10-25. Only the owner adds direction here.

## Identity

- **Title / name shown to participants:** not decided. Use the placeholder `[JUDUL STUDI]`.
- **Logo:** Universitas Islam Indonesia, supplied by the owner (`public/img/logo-uii.png`, transparent PNG, cropped to the artwork). It is shown above every participant screen except the test itself. Not used on the admin page.

## Mood

Warm and friendly.

## Dials

ENERGY 2 / RHYTHM 1 / MOTION 1. Welcoming start and results screens, a few simple
consistent screens, hover states only, and no animation during the test.

## Palette

- Primary blue: `#093697`. Accent yellow: `#f6d106`.
- Yellow on white or the page background is 1.5:1, so it fails WCAG for text and for
  controls. It is only used as a fill behind dark ink (`#1d2433` on yellow is 10.4:1).
- Blue is used for headings, buttons and the focus ring (10.6:1 on white).

## Typography

Atkinson Hyperlegible, bundled in `public/fonts/` (SIL Open Font License) so participants' browsers never contact Google.

## Theme

Light only. No dark mode and no theme toggle.

## Open

- Study title.
