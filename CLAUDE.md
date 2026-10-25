# CLAUDE.md

Guidance for AI agents working in this repository.

## Project

A simple, free-to-run web app for the **Sustained Attention to Response Task (SART)**,
modelled on <https://cognitivetrain.com/attention-span-test/>. Participants fill an
identity form (no login), take the test, and the result is saved. Test settings
are admin-only.

The design and open decisions are in `PLAN.md`. Read it before you change anything.
The project is still in the planning stage, so no code exists yet.

## Principles

- **Simplest thing that works.** Use plain HTML, CSS and vanilla JS. No framework, no bundler,
  no build step. Do not add a dependency unless it removes real complexity.
- **Free tiers only.** Do not introduce paid services.
- **Participants never see or change settings.** Settings come from the backend.
  The frontend only reads them.
- **Scoring must match the reference** (see `PLAN.md` §2): correct hits, commission
  errors, omission errors, and accuracy = (hits + correct withholds) / total trials.
  Do not copy the reference's late-press double-counting bug. Every trial is scored
  exactly once.
- Keep the SART engine (sequence generation, trial logic, scoring) as pure
  functions, separate from DOM code, so it can be unit-tested with `node --test`.

## Conventions

- Do not commit secrets, deployment IDs or personal data. Endpoint URLs go in one config constant.
- Record any change to scoring or procedure in `PLAN.md` together with the reason for it.
