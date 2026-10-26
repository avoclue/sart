# CLAUDE.md

Guidance for AI agents working in this repository.

## Project

A simple, free-to-run web app for the **Sustained Attention to Response Task (SART)**,
modelled on <https://cognitivetrain.com/attention-span-test/>. Participants fill an
identity form (no login), take the test, and the result is saved. Test settings
are admin-only.

The design and open decisions are in `PLAN.md`. Read it before you change anything.
The app is built: participant pages, admin page and backend. `DESIGN.md` holds the UI direction.

## Principles

- **Simplest thing that works.** Use plain HTML, CSS and vanilla JS. No framework, no bundler,
  no build step. Do not add a dependency unless it removes real complexity.
- **Free tiers only.** Do not introduce paid services.
- **Participants never see or change settings.** Settings come from the backend.
  The frontend only reads them.
- **Scoring must match the reference** (see `PLAN.md` §2) in the default "Klasik" response
  mode: correct hits, commission errors, omission errors, and accuracy = (hits + correct
  withholds) / total trials. Do not copy the reference's late-press double-counting bug.
  Every trial is scored exactly once. The "Tunggu mask" mode is a deliberate, documented
  variant with an extra `early` outcome (`PLAN.md` §9 D31); keep it separate from Klasik.
- Keep the SART engine (sequence generation, trial logic, scoring) as pure
  functions, separate from DOM code, so it can be unit-tested with `node --test`.

## Conventions

- **Language:** code, comments, commit messages and docs are in English. All UI text
  (participant pages and the admin page) is in Bahasa Indonesia.
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/):
  - Subject line format: `<type>: <description>`. `type` is one of `feat`, `fix`, `docs`,
    `refactor`, `test`, `chore`, `style`, `perf`, `build` or `ci`.
  - The description starts with an imperative verb in lowercase, is one sentence,
    and has no trailing period. For example, `feat: add trial-level CSV export`.
  - A body is optional. Separate it from the subject with a blank line.

- Do not commit secrets, deployment IDs or personal data. Endpoint URLs go in one config constant.
- Record any change to scoring or procedure in `PLAN.md` together with the reason for it.
