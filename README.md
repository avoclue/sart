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
| GET | `/api/sets` | none | Active test sets: code and label only |
| GET | `/api/settings?set=code` | none | One active set's test settings (404 for an unknown or inactive set) |
| POST | `/api/results` | none | Save a completed or aborted session with its trials |
| GET/POST | `/api/admin/sets` | admin | List test sets with their session counts, or add one |
| PUT/DELETE | `/api/admin/sets/:id` | admin | Change a set, or delete one no session uses |
| GET | `/api/admin/sessions` | admin | All sessions (`?include_trial=1` adds trial-mode sessions, `?set=code` keeps one set) |
| GET | `/api/admin/sessions/:id/trials` | admin | Trial rows for one session |
| GET | `/api/admin/export/sessions.csv` | admin | Session summary CSV (same filters as sessions) |
| GET | `/api/admin/export/trials.csv` | admin | Trial-level CSV (same filters as sessions) |

Admin auth is HTTP Basic: any username, with the password from the `ADMIN_PASSWORD` secret.

## Admin page

Open `/admin/` (locally http://localhost:8787/admin/). The browser asks for a username and
password: any username works, and the password is `ADMIN_PASSWORD`. To log out, close the browser.

Settings are kept per **test set** (`PLAN.md` §9 D38). Each set has a code and a label.
Participants open a set with `/?set=code`. The plain link `/` shows a required list of the
active sets in the form. Add a set with "Tambah set", which copies the selected set.

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

Run these on your own computer, from the project folder. Everything stays on the free plan.

1. **Log in:** `npx wrangler login` opens the browser to authorise Wrangler for your Cloudflare account.
2. **Create the database:** `npx wrangler d1 create sart --location apac`. The location is a hint
   to place the data in Asia Pacific. Copy the printed `database_id` into `wrangler.toml`, replacing
   the zeros. Do not commit that change; `git update-index --skip-worktree wrangler.toml` hides it
   from git (undo with `--no-skip-worktree`).
3. **Create the tables:** `npm run db:migrate:remote`, and answer yes. Run it again whenever a new
   file appears in `migrations/`.
4. **Deploy:** `npm run deploy`. It prints the address, `https://sart.<your-subdomain>.workers.dev`.
   On a new account Wrangler may first ask you to choose that subdomain.
5. **Set the admin password:** `npx wrangler secret put ADMIN_PASSWORD`, then type the password.
   It takes effect without another deploy. Until it is set, `/admin/` says the password is missing.
6. **Check:** open the address, take one test, then open `/admin/` and confirm the session is there.

### Later updates

```sh
git pull
npm run db:migrate:remote   # only if migrations/ changed
npm run deploy
```

### Backup

```sh
npx wrangler d1 export sart --remote --output backup.sql
```
