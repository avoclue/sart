# SART — Implementation Plan

Status: **built, not yet deployed.** Engine, backend, participant UI and admin UI are done. Remaining work is in §8. **Planned, not built yet:** test sets (§9 D38). Decisions are in §3 and §9. Open items are in §8.

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
| Sequence | `floor(trials × targetFrequency)` threes (we round to the nearest instead, §9 D28); every other trial is a random digit from {1,2,4,5,6,7,8,9}; then the whole list is shuffled (Fisher–Yates) |
| Trial timing | Digit shown for `displayDuration` ms, then 200 ms blank, then the next digit |
| Start delay | 1000 ms after pressing Start |
| Mask / practice block | None |
| End early | "End Test" button; confirms, then discards the session (not saved) |

### Settings (admin-only in our version)

| Setting | Options | Default |
|---|---|---|
| Display duration | 250 / **500** / 750 ms (a free number from 100 to 2000 ms in our version, §9 D34) | 500 ms |
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
| 4 | Settings | Same defaults as the reference (§2). Display duration keeps the reference's three options; session length and the proportion of 3s became free entries on 2026-10-26 (§9 D27). |
| 5 | Double-count bug | Fix it. |
| 6 | Reaction time | Record it. |
| 7 | Results visible to participant | Yes. |
| 8 | Retry | Allowed. |
| 9 | Language | UI in **Bahasa Indonesia**. Code and docs in English. |
| 10 | Hosting | Cloudflare. |
| R1–R7 | Research additions | All accepted (trial-level data, RT metrics, rates, anticipations, practice, aborted sessions saved, data-quality checks). Practice is an **admin-controlled trial mode** (§9 D3), not a block before every test. |
| R8 | Classic SART comparability | Built as options: random font sizes (D26), random font color (D37), 225 trials at 11.1% (D27, D28), balanced digits (D29), the 900 ms mask (D30) and a practice block (D33). |
| — | Dashboard | **Admin only.** Covers RT and other metrics; scope in §6. Participants see only the accuracy (§9 D36). |
| 11 | Scale and devices | About 30 participants, desktop first. Mobile must still work. |

## 4. Architecture

### Chosen: everything on Cloudflare (Workers with Static Assets + D1)

```
Browser ── static HTML/JS (Worker static assets, public/)
   │ GET  /api/sets               → active test sets, code and label only (§9 D38, planned)
   │ GET  /api/settings?set=code  → D1 table settings (one row per test set, §9 D38, planned)
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

- `settings`: **planned (§9 D38):** one row per test set, with `code`, `label`, `is_active`
  and every test setting. Built today as a single row with `display_duration_ms`,
  `total_trials`, `target_frequency`, `trial_mode` (0/1) and the later settings
- `sessions`: one row per test attempt
  - `id`, `created_at` (UTC), `participant_id` (normalised: trimmed, lowercase),
    `participant_id_raw`, `participant_name`, `attempt_no`, `is_trial` (0/1),
    `status` (completed/aborted), `consent_at` (UTC)
  - settings used, plus the summary metrics (§6), `started_at` and `duration_ms` (D35)
  - planned: `set_code`, the test set the session was taken in (D38)
  - device info: user agent, screen size, input type (keyboard/touch),
    `tab_hidden_count`
- `trials`: one row per trial (the raw data, so any metric can be recomputed later)
  - `session_id`, `trial_no`, `digit`, `is_target`, `responded`, `rt_ms`,
    `outcome` (hit/omission/commission/withhold), `extra_presses`

## 6. Metrics

Participants see only the accuracy (§9 D36). Correct Hits, Commission Errors and Omission
Errors are still computed and stored, and researchers see them on the admin page.

These are stored for researchers only and shown on the admin dashboard:
- mean RT and SD of RT on correct hits
- RT coefficient of variation (SD/mean)
- commission rate (commissions ÷ 3-trials)
- omission rate (omissions ÷ non-3 trials)
- anticipation count (presses faster than 100 ms)

Practice sessions are saved with `is_trial = 1` and their `practice_no` (see §9 D33).
Aborted sessions are saved with `status = aborted`.

### Admin dashboard (admin only)

- A per-session table with every metric. It is sortable and can be filtered by name and status.
- Trial-mode sessions are hidden by default, with a filter to show them.
- Planned (D38): a test set filter for the table, summary cards and charts, and a flag on
  participant IDs that have a main session in only some of the active sets.
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

### Content from the research team
- Study title (replaces `[JUDUL STUDI]` in `public/index.html`). The logo is done.
- Consent text (replaces `[TEKS PERSETUJUAN: ...]` in `public/index.html`).
- Review of the drafted Indonesian participant text: form intro, instructions, feedback reasons, results labels.
- Review of the admin glossary ("Penjelasan istilah"), especially the interpretive sentences.
- Check the Robertson et al. (1997) font sizes (48, 72, 94, 100, 120 pt) against the paper.
- Final identity fields (name + participant ID for now).

### Before the study
- Deploy (README "Deploy") and attach the custom subdomain.
- Pilot with 3 to 5 people on the real devices and network, including one phone.
- Give participants device instructions: laptop plugged in, other apps closed, an up-to-date browser, the test tab kept in front.
- Choose the settings for the study. For classic SART: 250 ms digits, mask 900 ms, mode Klasik,
  225 digits at 11.1%, balanced digits on, random font size on, plus the number of practice sessions. Random font color is off for classic SART.
- After the test sets (D38) are built: wipe the existing test data (the owner does this by hand,
  decided 2026-10-26), apply the migration, then create the study's sets (for example `a`, and `b` as a
  copy of `a` with random font color on), and check each link and the set list on the plain link.

### Possible improvements (deferred on 2026-10-26)
- Keep an unsaved result in browser storage and retry the save when the page is reopened.
  Today a result is lost if the save fails and the tab is closed.
- A load-test script to run against the real deployment before the study.
- Record the actual on-screen duration of each digit, to spot devices whose timers lag.

## 9. Behaviour details (confirmed 2026-10-25)

| # | Topic | Decision |
|---|---|---|
| D1 | Reaction time | Measured from digit onset (`performance.now()`). Only the first press in a trial's response window counts; later presses only increase `extra_presses`. |
| D2 | Anticipations (< 100 ms) | Still scored as normal presses, so the four reference metrics are unchanged. They are counted separately and excluded from the RT metrics. |
| D3 | Trial mode | **Changed by D33:** the switch now means "the study is in its practice period": participants can do up to N practice sessions and no main session is offered. A switch in the admin settings. **On:** every test a participant takes is a practice session. It uses the same settings (duration, length, frequency) as the real test, shows a "Sesi Latihan" label, and gives "Benar"/"Salah" feedback after every trial. The server sets `is_trial = 1` from its own setting when the session is saved (the browser cannot choose it), and is hidden from the dashboard and CSVs by default (a filter shows it). **Off:** every test is the real test, with no feedback. The study runs a trial period first and then the real period. |
| D4 | Participant ID and attempt number | The form requires a **name** and a **participant ID**. The ID is free text with no validation against a list; it is matched trimmed and case-insensitive. The attempt number is counted on the server: the number of earlier sessions with the same ID and the same `is_trial` value, plus 1. The name is shown for display only. |
| D5 | End Test early | **Changed by D19 and D33:** an early end no longer returns to the start screen. Confirm dialog, then save the session as `aborted` along with the trials completed so far. The participant returns to the start screen. |
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
| D17 | Trial-mode feedback | **Changed by D33:** feedback now applies to every practice session of the visit flow, not only to trial mode. Wait-for-mask mode adds a reason for early presses (D31). An admin setting with three values: `off` (default), `errors` (show "Salah" with the reason on mistakes: "Jangan tekan saat angka 3 muncul." after a press on a 3, "Tekan untuk setiap angka selain 3." after a missed digit) and `all` (also "Benar" on correct trials). It only applies in trial mode; real sessions never show feedback. Feedback appears as soon as the outcome is final: at the press for a hit or a press on a 3, and when the window closes for a miss or a correct withhold. The setting in force is stored per session (`feedback_mode`, always `off` for real sessions). |
| D18 | Feedback pause | When feedback is shown, the next digit waits an extra 1000 ms after the response window (raised from 500 ms on 2026-10-26 so the reason for an error can be read). So practice timing differs from the real test only after trials that get feedback. Presses during the pause belong to no trial and are ignored. |
| D19 | End Test early (refines D5) | Opening the confirm dialog pauses the test and discards the trial in progress. Confirming saves the completed trials as `aborted`. Cancelling resumes after 1000 ms by replaying the same digit, so the sequence and its count of 3s stay intact. |
| D20 | Retry and return | **Replaced by D33:** there is no retry after the main session. "Ulangi tes" on the results screen goes back to the instructions with the same name, ID and consent; the server gives the next attempt number. After an early end the participant is back at the form with name and ID kept, and must tick consent again. |
| D21 | Input | Spacebar on a keyboard, or a touch or pen tap on the test area. Mouse clicks are not responses, because the instructions ask for the spacebar on a computer. The session's `input_type` is `keyboard`, `touch`, `mixed` (both used in one session) or `none` (no press at all). |
| D22 | Test length shown | **Changed by D30 and D32:** the estimate includes the 3 s countdown and uses the mask instead of the 200 ms blank when one is set, and shows practice and main sessions separately. The instructions show an estimate in whole minutes, rounded up: (1000 ms + trials × (display + 200 ms)) / 60 s. Feedback pauses are not included. No other setting is shown. |
| D23 | Dashboard basis | Each participant is represented by their **latest completed real session**: practice and aborted sessions are left out, and a retry replaces the earlier attempt. The summary means (with n per metric) and both charts use this set. The participant and session counts cover all real sessions. |
| D24 | Dashboard charts | Accuracy and RT variability (CV) are dot strips with one dot per participant, because with about 30 people a histogram hides individuals and has a noisy shape. Clicking "Lihat RT" on a session row shows its RT for each trial, with hits and presses on a 3 drawn in different shapes. Misses and correct withholds have no RT, so they are drawn in a band below 0 ms: × marks for misses, green rings for correct withholds. Every trial is then visible. The y-axis always spans the full response window (display + 200 ms), so sessions with the same settings share one scale. |
| D25 | Admin page | Text in Bahasa Indonesia. Chart.js 4.4.1 comes from cdnjs, pinned with a Subresource Integrity hash. If it fails to load, the page says so and the tables still work. Settings save directly with no confirm step. Settings are not changed mid-study. Logging out means closing the browser (Basic Auth), and the page says so. The text filter matches name or participant ID. |
| D26 | Random font size | An admin on/off setting (default off) for both practice and real sessions. When on, each trial shows its digit in one of the five Robertson et al. (1997) sizes, 48, 72, 94, 100 or 120 pt, drawn with equal chance. Screens have no fixed pt size, so 120 pt is the normal digit size and the rest are scaled by size / 120 (40%, 60%, 78%, 83% and 100%). The size is drawn before the test, so a replayed trial (D19) keeps it. It is saved per trial (`font_size_pt`, empty when off), and the setting is saved per session (`random_font_size`). This is the only part of R8 adopted so far. |
| D27 | Free-text settings | Session length is a whole number from 10 to 500, and the proportion of 3s is a percentage from 1% to 50% with at most one decimal (for example 11.1%). Reason: to allow presets such as classic SART (225 trials) that the reference's three options cannot express. A combination with no 3s at all is refused. The admin form and the server use the same check (`settingsProblem` in `sart.js`). The 500 cap keeps a saved session well inside the request size limit. All trials of a session are now saved in one JSON statement, so long sessions stay within D1's per-request query limit. |
| D28 | Number of 3s | The number of 3s is trials × proportion **rounded to the nearest whole number** (halves up), not rounded down as in the reference. Reason: classic SART (Robertson et al., 1997, as implemented by Inquisit and PsyToolkit) shows each digit 25 times in 225 trials, so the 3 is 25 / 225 = 11.1% (described in the literature as "11%", ".11" or "1 in 9"). Rounding down turned 11.1% of 225 into 24 threes (10.7%); rounding to nearest gives 25. For the reference's own nine combinations (50/100/200 × 10/20/30%) the product is whole, so their sequences do not change. Non-3 digits are still drawn at random rather than balanced as in classic SART (see R8). |
| D29 | Balanced digits | An admin on/off setting in the test group (default off) for practice and real sessions. When on, the number of 3s still comes from the proportion setting (D28), and the other eight digits share the remaining trials as equally as possible: counts differ by at most 1, and the digits that get the extra trial are chosen at random. The order is a plain shuffle with no further constraint, as in the Inquisit SART. At 225 trials and 11.1% this is exactly classic SART, with every digit shown 25 times. When off, each non-3 digit is drawn at random as in the reference. The server refuses a balanced session whose digit counts do not fit. The setting is saved per session (`balanced_digits`). |
| D30 | Mask after each digit | **Changed by D34:** now a free number. An admin setting: off (default), 500, 900 (classic SART) or 1150 ms. When set, a circle with a diagonal cross replaces the digit for that time and the next digit follows at once; the 200 ms blank is only used without a mask. The response window becomes digit + mask, and the trial is still scored once at its end. The mask has one fixed size, about a normal digit's height, also when random font size is on. It is independent of the digit duration. Reason for 500 and 1150 ms: the owner wanted the duration to be adjustable; only 900 ms matches published SART. The setting is saved per session (`mask_ms`). Inquisit and PsyToolkit describe the classic mask as a circle with a cross, shown 900 ms after a 250 ms digit. |
| D31 | Response mode | An admin dropdown: **Klasik** (default) and **Tunggu mask**. Klasik is the classic rule: a press during the digit or the mask counts and RT is measured from digit onset. Tunggu mask is a **variant that is not the classic SART**, added at the owner's request: a non-3 must be answered while the mask shows. A press on a non-3 during the digit is a new outcome, `early` ("terlalu cepat"), and the first press decides, so a later press during the mask does not make it a hit. A press on a 3 is a commission whenever it happens. RT is measured from mask onset, so early presses have a negative RT. Early presses lower accuracy, are not omissions or anticipations, and are counted per session (`early_count`); participants do not see the count. Tunggu mask needs a mask. Results from Tunggu mask sessions should not be compared directly with published SART norms or with Klasik sessions. |
| D32 | Countdown | Every session, and every resume after "Lanjutkan tes", starts with a large 3, 2, 1 at one second per step, replacing the silent 1000 ms start delay. |
| D33 | Practice flow | Every visit runs: form, instructions, practice 1, then after each practice a screen with its results and the choice "Latihan lagi (k dari N)" or "Mulai sesi utama"; after practice N only the main session is offered. N (0 to 5, default 1) and the digits per practice session (10 to 500, default 18, as in PsyToolkit's practice block) are admin settings; every other test setting is shared with the main session, and feedback is shown in practice only. N = 0 goes straight to the main session. A practice ended early is saved as aborted, counts toward N, and returns to the choice screen. After the main session the participant sees the results and a thank-you, with no retry; a main session ended early ends with a short closing screen. The practice count is kept in the browser per visit, so reloading the page starts again from practice 1. The trial-mode switch (D3) now means the study's practice period: only practice is offered, and it needs N of at least 1. Each session stores its `practice_no` and a `visit_id` shared by every session of the visit. |
| D34 | Free duration and mask | Display duration and mask length are free whole numbers instead of dropdowns, as session length already was (D27). Display duration: 100 to 2000 ms. Mask: 0 (off) or 100 to 2000 ms. Reason: the owner wanted to try values the fixed options could not express. The lower bound of 100 ms is because a 60 Hz screen draws a frame about every 17 ms and browser timers are not precise below that; it is a guard, not a validated minimum, so very short digits need a pilot on the real devices. The upper bound only stops typos. The admin form, the server and the database all check the same range (`settingsProblem` in `sart.js`, migration 0006). The reference's 250 / 500 / 750 ms are still valid values. |
| D35 | Session duration and countdown text | Each session stores `started_at` (UTC, when the countdown began) and `duration_ms` (from then until the last trial's window closed, or until "Akhiri tes" was pressed for an early end). A pause for the end dialog that is cancelled counts as part of the duration, because the participant really took that long. It is measured by the participant's browser clock (`performance.now()`), so the server only checks that it is a whole number from 0 to 24 hours; both fields are empty for sessions saved before migration 0006 or by a page loaded before it. The admin session table and the sessions CSV show them. The countdown also shows "Tes dimulai dalam..." above the number, including when a paused test resumes. |
| D36 | Participant results show accuracy only | The results screen after a practice or main session shows only the accuracy. Correct hits, commission errors and omission errors are not shown, but they are still stored and shown to researchers. This changes §3 decision 7 and §6, which showed four metrics. Practice feedback during the session (D17) is unchanged. |
| D37 | Random font color | An admin on/off setting (default off) for practice and real sessions. When on, each trial shows its digit in red, yellow or blue. The colors are **balanced**: each appears equally often in a session (counts differ by at most 1, the extra trials go to random colors), in a random order that does not depend on the digit or the font size. Colors are drawn before the test, so a replayed trial (D19) keeps its color. The color is **purely visual**: when to press does not change, so scoring and the four reference metrics are unaffected. It is saved per trial (`font_color`, empty when off) and per session (`random_font_color`), and the server refuses a color outside the three, a color when the setting is off, or counts that are not balanced. Reason: same idea as random font size (D26), at the owner's request. The first request named green; the owner corrected it to yellow. Pure yellow `#f6d106` is only 1.4:1 on the page background (DESIGN.md), so the yellow digit is the mustard `#b58900` (3:1, the WCAG minimum for large text); red is `#c4161c` and blue `#1a56db`. The mask and feedback text keep their own colors. **Not built, deferred by the owner on 2026-10-26:** a no-go color (blue, "do not press when it shows") and its instruction. If it comes back, these questions are open: the no-go share (balanced colors with digit 3 as well would make about 47% of trials no-go, far from classic SART's rare no-go), what "balanced" covers, how scoring and `is_target` would change, the feedback and instruction wording, and its interaction with "Tunggu mask". |
| D38 | Test sets (planned 2026-10-26, not built) | **Why:** the study runs more than one configuration with the same participants on the same day, for example set A and set B, where B is A with random font color (D37) on. Changing the one settings row between A and B invites human error, and a single global switch would give the wrong set to anyone at a different stage. **Sets:** the settings table holds one row per set. Each set has every test setting, including its own practice-period switch (D3), practice settings (D33) and feedback mode, plus a **code**, a **label** and an **active** switch. **Code:** lowercase letters, digits and `-`, 1 to 20 characters, unique, matched case-insensitively. It is used in the link (`/?set=b`), stored on every session (`set_code`) and in both CSVs. It cannot be changed once any session uses it, because the data refers to it. Rejected: auto-numbered IDs (meaningless in a CSV) and random tokens (only needed to stop participants guessing other links, and a researcher guides every participant). **Label:** free text, for example "Set B", editable at any time, shown to participants on the form and instructions screens so the researcher can check the set (accepted by the owner). On the plain link participants see every active set's label, so labels should be neutral ("Set A", not "Set B (warna acak)"): a label that names the condition tells participants what is being tested. The admin page says this next to the label field. **Opening a set:** `/?set=code` opens that set; the form shows its label and no set field. A link with an unknown or inactive code shows an error ("Tautan tidak valid, minta tautan ke peneliti"). The **plain link** (no `set`) adds a required "Set" dropdown as the first form field, listing the active sets by label, with nothing pre-selected ("— Pilih set —"). After the form is submitted the page adds `?set=code` to the address, so a reload stays in the same set. With no active set, the plain link says the test is not open yet. The list comes from a public endpoint that returns only the active sets' codes and labels. **No default set** (decided 2026-10-26): a default, or a pre-selected first option, would let a forgotten choice silently run the wrong set. Rejected alternatives: a default set for the plain link (silent wrong set), an error page for the plain link (the plain link becomes unusable), and a typed set code (typos, and an empty field would need a default). Accepted risk: participants could pick a set themselves, as they could by editing the URL; a researcher guides every participant. **Active switch:** an inactive set's link stops working, but its data and settings are kept. A session already running when its set is deactivated is still saved. **Admin page:** a list of sets (code, label, active, default, number of sessions); selecting one edits its settings with the existing form. "Tambah set" copies the selected set's settings, then asks for a new code and label. A set can be deleted only while no session uses it (D10). **Order of sets:** not enforced. The researcher tells each participant which link to do and in which order; each set is its own visit, with the form (name, ID, consent) filled again. The owner chose this over one visit that runs several sets. Because the order is not controlled by the app, any order effect between sets (practice, fatigue) is the research team's to handle in the study design. **Data:** the attempt number (D4) is counted per participant ID, per set and per `is_trial`. A `visit_id` belongs to one set. The dashboard basis (D23) is the latest completed main session per participant **per set**, shown for the set chosen in a set filter. The CSVs include every set, with `set_code`, unless filtered. The server reads the set by the code the page sends, takes `is_trial` and the feedback mode from that set (as today), and refuses an unknown code. **Migration:** the existing settings row becomes set `a`, label "Set A", active. The owner wipes existing sessions before the migration, so old sessions need no set. |
