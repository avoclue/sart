# SART

A Sustained Attention to Response Task web app on Cloudflare Workers (static assets) and D1.
The design is in `PLAN.md`, and the UI direction is in `DESIGN.md`.

## Layout

- `public/`: static files served to the browser. `public/js/sart.js` is the pure SART engine,
  and `public/js/dashboard.js` holds the pure dashboard helpers. `public/admin/` is the admin page.
- `src/worker.js`: the API and admin auth. `src/validate.js` and `src/csv.js` are pure helpers.
- `migrations/`: D1 schema.
- `test/`: unit tests (`node --test`).

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/settings` | none | Current test settings |
| POST | `/api/results` | none | Save a completed or aborted session with its trials |
| GET/PUT | `/api/admin/settings` | admin | Read or change settings |
| GET | `/api/admin/sessions` | admin | All sessions (`?include_trial=1` adds trial-mode sessions) |
| GET | `/api/admin/sessions/:id/trials` | admin | Trial rows for one session |
| GET | `/api/admin/export/sessions.csv` | admin | Session summary CSV |
| GET | `/api/admin/export/trials.csv` | admin | Trial-level CSV |

Admin auth is HTTP Basic: any username, with the password from the `ADMIN_PASSWORD` secret.

## Admin page

Open `/admin/` (locally http://localhost:8787/admin/). The browser asks for a username and
password: any username works, and the password is `ADMIN_PASSWORD`. To log out, close the browser.

## Local development

```sh
npm install
cp .env.example .env  # then set ADMIN_PASSWORD in .env
npm run db:migrate:local
npm run dev          # http://localhost:8787
npm test
```

Wrangler reads `.env` only when there is no `.dev.vars` file, so do not create one.

## Deploy

1. `npx wrangler d1 create sart`, then put the printed `database_id` in your local `wrangler.toml`.
2. `npm run db:migrate:remote`
3. `npx wrangler secret put ADMIN_PASSWORD`
4. `npm run deploy`
