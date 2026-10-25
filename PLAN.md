# SART — Implementation Plan

Status: **draft — answers recorded in §3, backend + research items awaiting confirmation (§8)**

## 1. Goal

A simple web-based Sustained Attention to Response Task (SART), modelled on
<https://cognitivetrain.com/attention-span-test/>:

- Participant fills a short identity form (no login), then takes the test.
- The test uses the same procedure and scoring metrics as the reference.
- Test settings are fixed by an admin. Participants cannot see or change them.
- Every completed test result is saved.
- Everything runs on free tiers. Keep it as simple as possible.

## 2. Reference behaviour (taken from the reference page's own JavaScript)

These details come from the page's source code, not just its description text.

### Procedure

| Item | Reference behaviour |
|---|---|
| Stimuli | Digits 1–9; target (no-go) digit is **3** |
| Response | Spacebar on desktop, tap the test area on mobile |
| Sequence | `floor(trials × targetFrequency)` threes; every other trial is a random digit from {1,2,4,5,6,7,8,9}; then the whole list is shuffled (Fisher–Yates) |
| Trial timing | Digit shown for `displayDuration` ms, then 200 ms blank, then the next digit |
| Start delay | 1000 ms after pressing Start |
| Mask / practice block | None |
| End early | "End Test" button; confirms, then discards the session (not saved) |

### Settings (admin-only in our version)

| Setting | Options | Default |
|---|---|---|
| Display duration | 250 / **500** / 750 ms | 500 ms |
| Session length | 50 / **100** / 200 trials | 100 |
| Target frequency | 10% / **20%** / 30% | 20% |

### Scoring

| Metric | Definition |
|---|---|
| Correct Hits | Pressed on a non-3 digit |
| Commission Errors | Pressed on a 3 (false alarm) |
| Omission Errors | Did not press on a non-3 digit (miss) |
| Correct Withholds | Did not press on a 3 (computed, not shown on the results screen) |
| Accuracy | `round((correctHits + correctWithholds) / totalTrials × 100)` % |

### Bug in the reference that we should NOT copy

A trial is scored when its digit disappears, but responses stay open during
the 200 ms blank that follows. A late press therefore counts twice:

- Non-3 digit, pressed during the blank → **both** an omission **and** a hit.
- A 3, pressed during the blank → **both** a correct withhold **and** a commission.

At the 250 ms "Fast" setting most human reactions (~300–400 ms) land in the
blank, so this distorts the scores badly. **Proposed fix:** the response window
is the digit display plus the blank that follows it, and the trial is scored
once at the end of that window. Metric definitions stay the same.
(Needs your confirmation — open question Q5.)

## 3. Decisions (answers from 2026-10-25)

| # | Topic | Decision |
|---|---|---|
| 1 | Backend | Not Google Apps Script. A simple admin page with export is needed. Final choice is in §4. |
| 2 | Identity form | Name only for now. More fields are still being discussed. |
| 3 | Purpose | **Research.** A consent checkbox is required before the test starts. The consent text will come from the research team; a placeholder is used until then. |
| 4 | Settings | Same options and defaults as the reference (§2). |
| 5 | Double-count bug | Fix it. |
| 6 | Reaction time | Record it. |
| 7 | Results visible to participant | Yes. |
| 8 | Retry | Allowed. |
| 9 | Language | UI in **Bahasa Indonesia**. Code and docs in English. |
| 10 | Hosting | Cloudflare. |
| R1–R7 | Research additions | All accepted (trial-level data, RT metrics, rates, anticipations, practice round, aborted sessions saved, data-quality checks). |
| R8 | Classic SART comparability | **Still under discussion.** Follow the reference for now. |
| — | Dashboard | Admin dashboard for RT and other metrics. Scope in §6. |
| 11 | Scale and devices | About 30 participants, desktop first. Mobile must still work. |

## 4. Architecture

### Proposed: everything on Cloudflare (Pages + Pages Functions + D1)

```
Browser ── static HTML/JS (Cloudflare Pages)
   │ GET  /api/settings           → D1 table settings
   │ POST /api/results            → D1 tables sessions + trials
   │ /admin  (password protected) → view/edit settings, list results, CSV export
```

- **Frontend:** plain HTML, CSS and vanilla JS, with no build step.
- **API:** a few small Pages Functions (JS) with no framework.
- **DB:** Cloudflare D1 (SQLite). The free tier (5 GB, 100k writes/day) is far more than
  30 participants need. Unlike Supabase's free tier, it does not pause when it isn't used.
- **Admin auth:** one admin password stored as a Cloudflare secret and checked by
  the Functions (HTTP Basic Auth). This is the simplest option for a single admin.
  Cloudflare Access is an optional upgrade later.

### Alternative: Cloudflare Pages + Supabase

This also works for 30 users. But free projects **pause after about 7 days without
activity**, and a research study with gaps between sessions will hit that. It also
adds a second provider and requires writing Row Level Security policies.

## 5. Data model (D1)

- `settings`: a single row with `display_duration_ms`, `total_trials`, `target_frequency`
- `sessions`: one row per test attempt
  - `id`, `created_at` (UTC), `participant_name`, `attempt_no`, `status`
    (completed/aborted, see Q-R6)
  - settings used, plus the summary metrics (§6)
  - device info: user agent, screen size, input type (keyboard/touch),
    `tab_hidden_count`
- `trials`: one row per trial (the raw data, so any metric can be recomputed later)
  - `session_id`, `trial_no`, `digit`, `is_target`, `responded`, `rt_ms`,
    `outcome` (hit/omission/commission/withhold), `extra_presses`

## 6. Metrics

Participants see the four reference metrics: Accuracy, Correct Hits, Commission
Errors and Omission Errors.

These are stored for researchers only and shown on the admin dashboard:
- mean RT and SD of RT on correct hits
- RT coefficient of variation (SD/mean)
- commission rate (commissions ÷ 3-trials)
- omission rate (omissions ÷ non-3 trials)
- anticipation count (presses faster than 100 ms)

Practice round: about 18 trials before the scored test. These are not scored and not saved.
Aborted sessions are saved with `status = aborted`.

### Admin dashboard (proposed scope)

- A per-session table with every metric. It is sortable and can be filtered by name and status.
- Summary cards: number of participants, number of sessions, and the mean of each metric
  over completed sessions.
- A few simple charts: a distribution of accuracy and RT variability across participants,
  and an RT-by-trial plot for one session (this shows attention drifting).
- Charts use Chart.js loaded from a CDN, so there is still no build step.
- The dashboard is for monitoring the study. Formal analysis should use the CSV exports in R, SPSS or Python.

## 7. Implementation steps

1. Scaffold: `public/` (index, admin, js, css), `functions/api/…`, `schema.sql`,
   `wrangler.toml`, `README.md`.
2. SART engine as pure functions: sequence generation, trial state machine,
   scoring (every trial scored once), RT metrics. Unit tests with `node --test`.
3. Participant UI (Indonesian): name form plus consent checkbox, instructions,
   practice round, test, results, retry.
   Keyboard and touch input, ignoring held-key auto-repeat.
4. API: `GET /api/settings`, `POST /api/results` (validate, then insert the session and its trials in one batch).
5. Admin: login, settings form, dashboard (§6), and two CSV exports
   (sessions summary and trial-level data).
6. Local development: `wrangler pages dev` with a local D1 database (SQLite file
   under `.wrangler/`, git-ignored). Schema changes go through `wrangler d1 migrations`.
7. Deploy guide: create the remote D1 database, apply migrations with `--remote`, set
   `ADMIN_PASSWORD`, connect the repo to Pages.

## 8. Open items

- Backend choice: D1 (proposed) or Supabase.
- R8: whether to add a classic Robertson et al. (1997) preset (250 ms digit + 900 ms mask,
  225 trials, about 11% targets, random font sizes) for comparison with published norms.
- Consent text (from the research team).
- Final identity fields (name only for now).
