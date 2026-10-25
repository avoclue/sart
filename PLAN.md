# SART — Implementation Plan

Status: **building.** Engine, backend, participant UI and admin UI are done. Deployment is next. Decisions are in §3 and §9. Open items are in §8.

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
blank, so this distorts the scores badly. **Fix (confirmed):** the response window
is the digit display plus the blank that follows it, and the trial is scored
once at the end of that window. Metric definitions stay the same.

## 3. Decisions (answers from 2026-10-25)

| # | Topic | Decision |
|---|---|---|
| 1 | Backend | **Cloudflare Workers with Static Assets + D1 (SQLite).** Everything is deployed on Cloudflare. A simple admin page with export is needed. (Changed from Pages + Pages Functions on 2026-10-25, see §4.) |
| 2 | Identity form | **Name + participant ID**, both required. More fields are still being discussed. |
| 3 | Purpose | **Research.** A consent checkbox is required before the test starts. The consent text will come from the research team; a placeholder is used until then. |
| 4 | Settings | Same options and defaults as the reference (§2). |
| 5 | Double-count bug | Fix it. |
| 6 | Reaction time | Record it. |
| 7 | Results visible to participant | Yes. |
| 8 | Retry | Allowed. |
| 9 | Language | UI in **Bahasa Indonesia**. Code and docs in English. |
| 10 | Hosting | Cloudflare. |
| R1–R7 | Research additions | All accepted (trial-level data, RT metrics, rates, anticipations, practice, aborted sessions saved, data-quality checks). Practice is an **admin-controlled trial mode** (§9 D3), not a block before every test. |
| R8 | Classic SART comparability | **Still under discussion.** Follow the reference for now. |
| — | Dashboard | **Admin only.** Covers RT and other metrics; scope in §6. Participants see only the four reference metrics. |
| 11 | Scale and devices | About 30 participants, desktop first. Mobile must still work. |

## 4. Architecture

### Chosen: everything on Cloudflare (Workers with Static Assets + D1)

```
Browser ── static HTML/JS (Worker static assets, public/)
   │ GET  /api/settings           → D1 table settings
   │ POST /api/results            → D1 tables sessions + trials
   │ /admin  (password protected) → view/edit settings, list results, CSV export
```

- **Frontend:** plain HTML, CSS and vanilla JS, with no build step.
- **API:** one Worker (`src/worker.js`, no framework). It runs first on `/api/*` and `/admin*`;
  every other path is served straight from `public/`.
- **Why Workers, not Pages:** Cloudflare now recommends Workers with Static Assets for new
  projects and puts new features there. Free tier, D1 and Git deploys (Workers Builds) are the same.
- **DB:** Cloudflare D1 (SQLite). The free tier (5 GB, 100k writes/day) is far more than
  30 participants need. Unlike Supabase's free tier, it does not pause when it isn't used.
- **Admin auth:** one admin password stored as a Cloudflare secret and checked by
  the Functions (HTTP Basic Auth). This is the simplest option for a single admin.
  Cloudflare Access is an optional upgrade later.

### Rejected: Cloudflare Pages + Supabase

This also works for 30 users. But free projects **pause after about 7 days without
activity**, and a research study with gaps between sessions will hit that. It also
adds a second provider and requires writing Row Level Security policies.

## 5. Data model (D1)

- `settings`: a single row with `display_duration_ms`, `total_trials`, `target_frequency`,
  `trial_mode` (0/1)
- `sessions`: one row per test attempt
  - `id`, `created_at` (UTC), `participant_id` (normalised: trimmed, lowercase),
    `participant_id_raw`, `participant_name`, `attempt_no`, `is_trial` (0/1),
    `status` (completed/aborted), `consent_at` (UTC)
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

Trial-mode sessions are saved with `is_trial = 1` (see §9 D3).
Aborted sessions are saved with `status = aborted`.

### Admin dashboard (admin only)

- A per-session table with every metric. It is sortable and can be filtered by name and status.
- Trial-mode sessions are hidden by default, with a filter to show them.
- Summary cards: number of participants (distinct participant IDs), number of sessions, and the mean of each metric
  over completed sessions.
- A few simple charts: a distribution of accuracy and RT variability across participants,
  and an RT-by-trial plot for one session (this shows attention drifting).
- Charts use Chart.js loaded from a CDN (pinned, with an integrity hash), so there is still no build step.
- The dashboard is for monitoring the study. Formal analysis should use the CSV exports in R, SPSS or Python.

## 7. Implementation steps

1. Scaffold: `public/` (index, admin, js, css), `src/worker.js`, `migrations/`,
   `wrangler.toml`, `README.md`.
2. SART engine as pure functions: sequence generation, trial state machine,
   scoring (every trial scored once), RT metrics. Unit tests with `node --test`.
3. Participant UI (Indonesian): name + participant ID form, consent checkbox,
   instructions, test (with a "Sesi Latihan" label and per-trial feedback when trial mode is on), results, retry.
   Keyboard and touch input, ignoring held-key auto-repeat.
4. API: `GET /api/settings`, `POST /api/results` (validate, then insert the session and its trials in one batch).
5. Admin: login, settings form (including the trial-mode switch), dashboard (§6),
   and two CSV exports (sessions summary and trial-level data; trial-mode sessions
   excluded unless the admin includes them).
6. Local development: `wrangler dev` with a local D1 database (SQLite file
   under `.wrangler/`, git-ignored). Schema changes go through `wrangler d1 migrations`.
7. Deploy guide: create the remote D1 database, apply migrations with `--remote`, set
   `ADMIN_PASSWORD`, deploy with `wrangler deploy` or connect the repo with Workers Builds.

## 8. Open items

- Design dials (ENERGY / RHYTHM / MOTION), final blue and yellow hex codes, study title and logo (`DESIGN.md`).
- R8: whether to add the rest of a classic Robertson et al. (1997) preset (250 ms digit + 900 ms mask,
  225 trials, about 11% targets) for comparison with published norms. Random font sizes are done (§9 D26).
- Consent text (from the research team).
- Final identity fields (name + participant ID for now).

## 9. Behaviour details (confirmed 2026-10-25)

| # | Topic | Decision |
|---|---|---|
| D1 | Reaction time | Measured from digit onset (`performance.now()`). Only the first press in a trial's response window counts; later presses only increase `extra_presses`. |
| D2 | Anticipations (< 100 ms) | Still scored as normal presses, so the four reference metrics are unchanged. They are counted separately and excluded from the RT metrics. |
| D3 | Trial mode | A switch in the admin settings. **On:** every test a participant takes is a practice session. It uses the same settings (duration, length, frequency) as the real test, shows a "Sesi Latihan" label, and gives "Benar"/"Salah" feedback after every trial. The server sets `is_trial = 1` from its own setting when the session is saved (the browser cannot choose it), and is hidden from the dashboard and CSVs by default (a filter shows it). **Off:** every test is the real test, with no feedback. The study runs a trial period first and then the real period. |
| D4 | Participant ID and attempt number | The form requires a **name** and a **participant ID**. The ID is free text with no validation against a list; it is matched trimmed and case-insensitive. The attempt number is counted on the server: the number of earlier sessions with the same ID and the same `is_trial` value, plus 1. The name is shown for display only. |
| D5 | End Test early | Confirm dialog, then save the session as `aborted` along with the trials completed so far. The participant returns to the start screen. |
| D6 | Tab switch during the test | The test keeps running and `tab_hidden_count` is recorded. The dashboard flags sessions where the count is above 0. |
| D7 | Consent | The test cannot start until the checkbox is ticked. `consent_at` is stored with the session. The consent text is a placeholder for now. |
| D8 | Admin login | Password only (Basic Auth, any username). The password comes from the `ADMIN_PASSWORD` secret. |
| D9 | Times in the admin UI and CSV | Stored in UTC. Shown in WIB (Asia/Jakarta). |
| D10 | Deleting data | **Not included for now.** |
| D11 | Fullscreen | Not forced. |
| D12 | Dashboard "participants" | Count of distinct participant IDs (normalised as in D4). |
| D13 | RT standard deviation | Sample SD (divide by n − 1), matching R, SPSS and pandas, so the dashboard agrees with analysis of the CSV. Mean RT needs at least 1 correct hit and SD needs at least 2; otherwise they are empty. Rates with a zero denominator are empty too. |
| D14 | Aborted sessions | Accuracy and rates use the trials actually completed. Unshown trials are not omissions. `trials_completed` and the planned `total_trials` are both stored. |
| D15 | Anticipation count | Any first press under 100 ms after digit onset, on every trial (3s included). |
| D16 | Server-side scoring | The server rebuilds each trial's outcome from its digit and press, and recomputes every summary metric with the same engine module. Numbers sent by the browser are never stored. It also rejects settings outside the allowed options, a wrong number of 3s, and RTs outside the response window. |
| D17 | Trial-mode feedback | An admin setting with three values: `off` (default), `errors` (show "Salah" with the reason on mistakes: "Jangan tekan saat angka 3 muncul." after a press on a 3, "Tekan untuk setiap angka selain 3." after a missed digit) and `all` (also "Benar" on correct trials). It only applies in trial mode; real sessions never show feedback. Feedback appears as soon as the outcome is final: at the press for a hit or a press on a 3, and when the window closes for a miss or a correct withhold. The setting in force is stored per session (`feedback_mode`, always `off` for real sessions). |
| D18 | Feedback pause | When feedback is shown, the next digit waits an extra 1000 ms after the response window (raised from 500 ms on 2026-10-26 so the reason for an error can be read). So practice timing differs from the real test only after trials that get feedback. Presses during the pause belong to no trial and are ignored. |
| D19 | End Test early (refines D5) | Opening the confirm dialog pauses the test and discards the trial in progress. Confirming saves the completed trials as `aborted`. Cancelling resumes after 1000 ms by replaying the same digit, so the sequence and its count of 3s stay intact. |
| D20 | Retry and return | "Ulangi tes" on the results screen goes back to the instructions with the same name, ID and consent; the server gives the next attempt number. After an early end the participant is back at the form with name and ID kept, and must tick consent again. |
| D21 | Input | Spacebar on a keyboard, or a touch or pen tap on the test area. Mouse clicks are not responses, because the instructions ask for the spacebar on a computer. The session's `input_type` is `keyboard`, `touch`, `mixed` (both used in one session) or `none` (no press at all). |
| D22 | Test length shown | The instructions show an estimate in whole minutes, rounded up: (1000 ms + trials × (display + 200 ms)) / 60 s. Feedback pauses are not included. No other setting is shown. |
| D23 | Dashboard basis | Each participant is represented by their **latest completed real session**: practice and aborted sessions are left out, and a retry replaces the earlier attempt. The summary means (with n per metric) and both charts use this set. The participant and session counts cover all real sessions. |
| D24 | Dashboard charts | Accuracy and RT variability (CV) are dot strips with one dot per participant, because with about 30 people a histogram hides individuals and has a noisy shape. Clicking "Lihat RT" on a session row shows its RT for each trial, with hits and presses on a 3 drawn in different shapes. Misses and correct withholds have no RT, so they are drawn in a band below 0 ms: × marks for misses, green rings for correct withholds. Every trial is then visible. The y-axis always spans the full response window (display + 200 ms), so sessions with the same settings share one scale. |
| D25 | Admin page | Text in Bahasa Indonesia. Chart.js 4.4.1 comes from cdnjs, pinned with a Subresource Integrity hash. If it fails to load, the page says so and the tables still work. Settings save directly with no confirm step. Settings are not changed mid-study. Logging out means closing the browser (Basic Auth), and the page says so. The text filter matches name or participant ID. |
| D26 | Random font size | An admin on/off setting (default off) for both practice and real sessions. When on, each trial shows its digit in one of the five Robertson et al. (1997) sizes, 48, 72, 94, 100 or 120 pt, drawn with equal chance. Screens have no fixed pt size, so 120 pt is the normal digit size and the rest are scaled by size / 120 (40%, 60%, 78%, 83% and 100%). The size is drawn before the test, so a replayed trial (D19) keeps it. It is saved per trial (`font_size_pt`, empty when off), and the setting is saved per session (`random_font_size`). This is the only part of R8 adopted so far. |
