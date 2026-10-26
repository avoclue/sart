import { summarize, normaliseSetCode } from '../public/js/sart.js';
import { validateResult, validateSet, ValidationError } from './validate.js';
import { toCsv, SESSION_COLUMNS, TRIAL_COLUMNS } from './csv.js';

const MAX_BODY_BYTES = 100_000;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function csv(body, filename) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

// Basic Auth with any username; only the password is checked (PLAN.md §9 D8).
async function isAdmin(request, env) {
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try {
    // Browsers send the credentials as UTF-8 bytes, so decode them as UTF-8, not Latin-1.
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const password = decoded.slice(decoded.indexOf(':') + 1);
  const [a, b] = await Promise.all([sha256(password), sha256(env.ADMIN_PASSWORD)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function unauthorized() {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="SART admin", charset="UTF-8"' },
  });
}

// A cross-site form can only send text/plain, so requiring JSON forces a CORS preflight
// that the Worker never grants (PLAN.md §9 D39).
async function readJson(request) {
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new ValidationError('Content-Type must be application/json');
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > MAX_BODY_BYTES) throw new ValidationError('body too large');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ValidationError('body too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('body is not valid JSON');
  }
}

// One row of the settings table is one test set (PLAN.md §9 D38).
function setFromRow(row) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    isActive: row.is_active === 1,
    displayDurationMs: row.display_duration_ms,
    totalTrials: row.total_trials,
    targetFrequency: row.target_frequency,
    trialMode: row.trial_mode === 1,
    feedbackMode: row.feedback_mode,
    randomFontSize: row.random_font_size === 1,
    randomFontColor: row.random_font_color === 1,
    balancedDigits: row.balanced_digits === 1,
    maskMs: row.mask_ms,
    responseMode: row.response_mode,
    practiceSessions: row.practice_sessions,
    practiceTrials: row.practice_trials,
  };
}

async function findSet(env, code) {
  const row = await env.DB.prepare('SELECT * FROM settings WHERE code = ?').bind(normaliseSetCode(code)).first();
  return row ? setFromRow(row) : null;
}

// Only active sets are offered to participants: their code and label, no settings.
async function activeSets(env) {
  const { results } = await env.DB.prepare(
    'SELECT code, label FROM settings WHERE is_active = 1 ORDER BY code',
  ).all();
  return results;
}

async function listSets(env) {
  const { results } = await env.DB.prepare(
    `SELECT st.*, (SELECT COUNT(*) FROM sessions WHERE set_code = st.code) AS session_count
     FROM settings st ORDER BY st.code`,
  ).all();
  return results.map((row) => ({ ...setFromRow(row), sessionCount: row.session_count }));
}

async function sessionCountForCode(env, code) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE set_code = ?').bind(code).first();
  return row.n;
}

async function codeTaken(env, code, exceptId = null) {
  const row = await env.DB.prepare('SELECT id FROM settings WHERE code = ? AND id IS NOT ?').bind(code, exceptId).first();
  return row !== null;
}

const conflict = (message) => json({ error: message }, 409);
const takenMessage = (code) => `Kode set "${code}" sudah dipakai set lain.`;

function setValues(s) {
  return [
    s.code, s.label, s.isActive ? 1 : 0, s.displayDurationMs, s.totalTrials, s.targetFrequency,
    s.trialMode ? 1 : 0, s.feedbackMode, s.randomFontSize ? 1 : 0, s.randomFontColor ? 1 : 0,
    s.balancedDigits ? 1 : 0, s.maskMs, s.responseMode, s.practiceSessions, s.practiceTrials,
    new Date().toISOString(),
  ];
}

async function createSet(request, env) {
  const s = validateSet(await readJson(request));
  if (await codeTaken(env, s.code)) return conflict(takenMessage(s.code));
  const { meta } = await env.DB.prepare(
    `INSERT INTO settings (code, label, is_active, display_duration_ms, total_trials, target_frequency,
       trial_mode, feedback_mode, random_font_size, random_font_color, balanced_digits, mask_ms,
       response_mode, practice_sessions, practice_trials, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(...setValues(s)).run();
  return json((await listSets(env)).find((set) => set.id === meta.last_row_id), 201);
}

// The code cannot change once a session uses it, because sessions refer to the set by code.
async function updateSet(id, request, env) {
  const s = validateSet(await readJson(request));
  const current = await env.DB.prepare('SELECT code FROM settings WHERE id = ?').bind(id).first();
  if (!current) return json({ error: 'Set tidak ditemukan. Muat ulang halaman.' }, 404);
  if (s.code !== current.code) {
    if (await sessionCountForCode(env, current.code) > 0) {
      return conflict('Kode set tidak bisa diubah karena sudah dipakai sesi.');
    }
    if (await codeTaken(env, s.code, id)) return conflict(takenMessage(s.code));
  }
  await env.DB.prepare(
    `UPDATE settings SET code = ?, label = ?, is_active = ?, display_duration_ms = ?, total_trials = ?,
       target_frequency = ?, trial_mode = ?, feedback_mode = ?, random_font_size = ?, random_font_color = ?,
       balanced_digits = ?, mask_ms = ?, response_mode = ?, practice_sessions = ?, practice_trials = ?,
       updated_at = ?
     WHERE id = ?`,
  ).bind(...setValues(s), id).run();
  return json((await listSets(env)).find((set) => set.id === id));
}

// A set can be deleted only while no session uses it (PLAN.md §9 D10, D38).
async function deleteSet(id, env) {
  const { meta } = await env.DB.prepare(
    `DELETE FROM settings WHERE id = ?
       AND NOT EXISTS (SELECT 1 FROM sessions WHERE set_code = settings.code)`,
  ).bind(id).run();
  if (meta.changes > 0) return json({ deleted: id });
  const exists = await env.DB.prepare('SELECT 1 FROM settings WHERE id = ?').bind(id).first();
  if (!exists) return json({ error: 'Set tidak ditemukan. Muat ulang halaman.' }, 404);
  return conflict('Set ini sudah dipakai sesi, jadi tidak bisa dihapus. Nonaktifkan saja.');
}

async function postResult(request, env) {
  const r = validateResult(await readJson(request));
  const summary = summarize(r.trials);
  const id = crypto.randomUUID();
  // Practice sessions of the visit flow are saved as practice (PLAN.md §9 D33). The participant
  // page only offers a main session while the practice period (trial mode) is off; a main
  // session already running when the admin turns it on is kept as a main session.
  // An unknown or inactive set is refused, so deactivating a set closes it for results too (D39).
  const current = await findSet(env, r.setCode);
  if (!current) throw new ValidationError('unknown set');
  if (!current.isActive) return json({ error: 'set inactive' }, 409);
  const isTrial = r.sessionKind === 'practice' ? 1 : 0;
  // Feedback is only shown in practice sessions, so main sessions always store 'off'.
  const feedbackMode = isTrial ? current.feedbackMode : 'off';

  // The attempt number is computed inside the INSERT so it is atomic (PLAN.md §9 D4), and is
  // counted per set (D38).
  const insertSession = env.DB.prepare(
    `INSERT INTO sessions (
       id, created_at, participant_id, participant_id_raw, participant_name, attempt_no, is_trial,
       status, consent_at, display_duration_ms, total_trials, target_frequency, trials_completed,
       correct_hits, commission_errors, omission_errors, correct_withholds, accuracy, mean_rt_ms,
       sd_rt_ms, rt_cv, commission_rate, omission_rate, anticipation_count, user_agent,
       screen_width, screen_height, input_type, tab_hidden_count, feedback_mode, random_font_size,
       balanced_digits, mask_ms, response_mode, early_count, practice_no, visit_id, started_at, duration_ms, random_font_color, set_code)
     SELECT ?, ?, ?, ?, ?, COUNT(*) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?, ?, ?
     FROM sessions WHERE participant_id = ? AND set_code = ? AND is_trial = ?`,
  ).bind(
    id, new Date().toISOString(), r.participantId, r.participantIdRaw, r.participantName, isTrial,
    r.status, r.consentAt, r.settings.displayDurationMs, r.settings.totalTrials,
    r.settings.targetFrequency, summary.trialsCompleted, summary.correctHits,
    summary.commissionErrors, summary.omissionErrors, summary.correctWithholds, summary.accuracy,
    summary.meanRtMs, summary.sdRtMs, summary.rtCv, summary.commissionRate, summary.omissionRate,
    summary.anticipationCount, request.headers.get('User-Agent')?.slice(0, 500) ?? null,
    r.screenWidth, r.screenHeight, r.inputType, r.tabHiddenCount, feedbackMode,
    r.settings.randomFontSize ? 1 : 0, r.settings.balancedDigits ? 1 : 0, r.settings.maskMs,
    r.settings.responseMode, summary.earlyCount, r.practiceNo, r.visitId, r.startedAt, r.durationMs, r.settings.randomFontColor ? 1 : 0, r.setCode,
    r.participantId, r.setCode, isTrial,
  );

  // All trials go in one statement as a JSON array. One row of bound values per trial would
  // need dozens of queries for a long session, and D1 caps the queries per request.
  const trialRows = JSON.stringify(r.trials.map((t) => [
    t.trialNo, t.digit, t.isTarget ? 1 : 0, t.responded ? 1 : 0, t.rtMs, t.outcome, t.extraPresses, t.fontSizePt, t.fontColor,
  ]));
  const insertTrials = env.DB.prepare(
    `INSERT INTO trials (session_id, trial_no, digit, is_target, responded, rt_ms, outcome, extra_presses, font_size_pt, font_color)
     SELECT ?1, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6, value ->> 7, value ->> 8
     FROM json_each(?2)`,
  ).bind(id, trialRows);
  await env.DB.batch([insertSession, insertTrials]);

  const { attempt_no: attemptNo } = await env.DB.prepare('SELECT attempt_no FROM sessions WHERE id = ?').bind(id).first();
  return json({ sessionId: id, attemptNo }, 201);
}

// Practice sessions are left out unless include_trial=1; ?set=code keeps one set (PLAN.md §9 D38).
function sessionFilter(url, alias = '') {
  const conditions = [];
  const binds = [];
  if (url.searchParams.get('include_trial') !== '1') conditions.push(`${alias}is_trial = 0`);
  const set = url.searchParams.get('set');
  if (set) {
    conditions.push(`${alias}set_code = ?`);
    binds.push(normaliseSetCode(set));
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', binds };
}

async function listSessions(url, env) {
  const { where, binds } = sessionFilter(url);
  const { results } = await env.DB.prepare(
    `SELECT * FROM sessions ${where} ORDER BY created_at DESC`,
  ).bind(...binds).all();
  return results;
}

async function listTrials(url, env) {
  const { where, binds } = sessionFilter(url, 's.');
  const { results } = await env.DB.prepare(
    `SELECT t.*, s.participant_id, s.set_code, s.attempt_no, s.is_trial, s.status, s.feedback_mode, s.random_font_size, s.random_font_color, s.balanced_digits,
       s.mask_ms, s.response_mode, s.practice_no, s.visit_id
     FROM trials t JOIN sessions s ON s.id = t.session_id ${where}
     ORDER BY s.created_at, t.trial_no`,
  ).bind(...binds).all();
  return results;
}

async function sessionTrials(id, env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM trials WHERE session_id = ? ORDER BY trial_no',
  ).bind(id).all();
  return results;
}

async function handleAdminApi(request, url, env) {
  const path = url.pathname.slice('/api/admin'.length);
  const method = request.method;

  if (path === '/sets' && method === 'GET') return json(await listSets(env));
  if (path === '/sets' && method === 'POST') return createSet(request, env);
  const setMatch = path.match(/^\/sets\/(\d+)$/);
  if (setMatch && method === 'PUT') return updateSet(Number(setMatch[1]), request, env);
  if (setMatch && method === 'DELETE') return deleteSet(Number(setMatch[1]), env);
  if (path === '/sessions' && method === 'GET') return json(await listSessions(url, env));
  const match = path.match(/^\/sessions\/([0-9a-f-]{36})\/trials$/);
  if (match && method === 'GET') return json(await sessionTrials(match[1], env));
  if (path === '/export/sessions.csv' && method === 'GET') {
    return csv(toCsv(SESSION_COLUMNS, await listSessions(url, env)), 'sart-sessions.csv');
  }
  if (path === '/export/trials.csv' && method === 'GET') {
    return csv(toCsv(TRIAL_COLUMNS, await listTrials(url, env)), 'sart-trials.csv');
  }
  return json({ error: 'not found' }, 404);
}

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/')) {
    // Without a password every login would fail with a bare 401, which looks like a typo.
    if (!env.ADMIN_PASSWORD) {
      console.error('ADMIN_PASSWORD is not set. Locally, put it in .env; when deployed, run: npx wrangler secret put ADMIN_PASSWORD');
      return new Response(
        'Admin belum bisa dibuka: ADMIN_PASSWORD belum diatur di server. Lihat README, bagian "Local development".',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      );
    }
    if (!(await isAdmin(request, env))) return unauthorized();
    if (pathname.startsWith('/api/admin/')) return handleAdminApi(request, url, env);
    return env.ASSETS.fetch(request);
  }
  if (pathname === '/api/sets' && request.method === 'GET') return json(await activeSets(env));
  if (pathname === '/api/settings' && request.method === 'GET') {
    // An unknown or inactive set is not offered (PLAN.md §9 D38). trialMode is included
    // because the participant app must label practice sessions.
    const set = await findSet(env, url.searchParams.get('set'));
    if (!set || !set.isActive) return json({ error: 'set not found' }, 404);
    const { id, isActive, ...settings } = set;
    return json(settings);
  }
  if (pathname === '/api/results' && request.method === 'POST') return postResult(request, env);
  return json({ error: 'not found' }, 404);
}

// Chart.js (admin page only) is the one external script, pinned with an SRI hash.
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self' https://cdnjs.cloudflare.com", "style-src 'self'",
    "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "object-src 'none'",
    "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function withSecurityHeaders(response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  return secured;
}

export default {
  async fetch(request, env) {
    try {
      return withSecurityHeaders(await route(request, env));
    } catch (err) {
      if (err instanceof ValidationError) return withSecurityHeaders(json({ error: err.message }, 400));
      console.error(err);
      return withSecurityHeaders(json({ error: 'internal error' }, 500));
    }
  },
};
