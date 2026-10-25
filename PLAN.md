# SART — Implementation Plan

Status: **draft, waiting on open questions** (see the end of this file).

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

## 3. Proposed architecture (free, minimal)

### Recommended: static page + Google Sheets (via Google Apps Script)

```
Browser (one static HTML/JS page)
   │  GET settings   ─────────▶ Apps Script web app ──▶ Sheet tab "Settings"
   │  POST result    ─────────▶ Apps Script web app ──▶ Sheet tab "Results" (append row)
```

- **Frontend:** plain HTML, CSS and vanilla JS. No framework and no build step.
- **Backend:** one Google Apps Script file (`doGet` returns settings, `doPost` appends a result row).
- **Storage:** one Google Sheet with two tabs: `Settings` and `Results`.
- **Admin:** the admin edits the `Settings` tab and reads/filters/exports the
  `Results` tab directly in Google Sheets. Access is controlled by Google's own
  sharing. **No admin page and no auth code to build.**
- **Hosting the page:** either let Apps Script serve the HTML (one deployment, no
  CORS), or use Cloudflare Pages / Netlify (free, nicer URL). Note: GitHub Pages
  is free only for **public** repos. A private repo needs a paid plan.

Why this option: it has the fewest moving parts, costs nothing, never "sleeps",
and the admin already knows how to use a spreadsheet.

Trade-offs to accept:

- The submit endpoint is public, so anyone with the URL could post fake rows. This is
  the same for any no-login app. Mitigation if needed: honeypot field plus a
  basic server-side shape check.
- Scoring happens in the browser, so a technical user could tamper with their
  own result. For an attention test without login this is normally acceptable.
- Apps Script has daily quotas (roughly 20k URL calls per day on a consumer account).
  That is far above what a test like this needs.
- If Apps Script serves the HTML, Google shows a small banner at the top of the page.

### Alternative: static page + Supabase (free tier)

- Postgres with Row Level Security: anonymous users can only `INSERT` results;
  only the admin can read results and update settings.
- Needs an admin page we build ourselves (login, settings form, results table,
  CSV export). That is roughly 2–3 times the work of the Sheets option.
- Free projects **pause after ~7 days without activity** and must be resumed by hand.

Use this only if you need a real admin UI, many concurrent users, or plan to
grow the app later.

## 4. Data model

**Settings** (one row; the admin edits the values)

| key | value |
|---|---|
| displayDurationMs | 500 |
| totalTrials | 100 |
| targetFrequency | 0.2 |

The values allowed match the reference options. Do we also allow custom values?
See Q4.

**Results** (one row per completed test)

| column | notes |
|---|---|
| submittedAt | server timestamp |
| sessionId | random UUID generated in the browser, used to remove duplicates on retry |
| *identity fields* | depends on Q2 (for example name, email, age, …) |
| displayDurationMs, totalTrials, targetFrequency | the settings actually used |
| accuracy, correctHits, commissionErrors, omissionErrors, correctWithholds | scores |
| meanRtMs *(optional)* | depends on Q6 |
| userAgent | helps tell desktop results from mobile results |

## 5. User flow

1. **Identity form.** Fields depend on Q2. Validated in the browser.
2. **Instructions.** "Press SPACE (or tap) for every digit EXCEPT 3", plus a
   Start button. No settings shown.
3. **Test.** Large digit in the centre, plus a live trial counter. Whether to show live hits and errors
   like the reference does is Q7.
4. **Results.** Accuracy, hits, commission errors and omission errors, shown or hidden
   depending on Q7. The result is saved automatically, with a retry if the network fails.
5. **Done screen.** Whether participants can retake the test is Q8.

## 6. Implementation steps

1. Repo scaffold: `index.html`, `app.js`, `style.css`, `apps-script/Code.gs`, `README.md`.
2. SART engine (pure functions, kept separate from the DOM so it is testable):
   sequence generation, trial state machine, scoring with the double-count fix.
3. UI: form → instructions → test → results. Desktop and mobile input. Mobile layout.
4. Apps Script backend: `doGet` (settings), `doPost` (validate and append a row), plus a
   setup function that creates both tabs with their headers.
5. Wire up: load settings before Start, submit the result, show error and retry states.
6. Tests: a few unit tests for the sequence and scoring (Node's built-in
   `node --test`, so no dependencies), plus a manual run in Chrome and on a phone.
7. Deploy: step-by-step guide in the README covering creating the Sheet, pasting the script, deploying
   it as a web app, and setting the endpoint URL in the frontend.

## 7. Out of scope (unless you say otherwise)

Login and accounts, charts and analytics dashboards, multiple languages, practice
blocks, a classic SART mask and variable font sizes, and per-user history.

## 8. Open questions

See the chat message accompanying this file. Answers will be recorded here.
