// Admin page: settings form, overview, session table, session detail and CSV links.

import { API_BASE } from '../js/config.js';
import { settingsProblem } from '../js/sart.js';
import {
  participantCount, realSessionCount, latestCompletedPerParticipant, metricMeans,
  filterSessions, sortSessions,
} from '../js/dashboard.js';

const $ = (id) => document.getElementById(id);
const BLUE = '#093697';
const RED = '#a3261b';
const INK = '#1d2433';
const GREEN = '#1e7a3c';

let sessions = [];
let sort = { key: 'created_at', direction: 'desc' };
const charts = {};

// Formatting

const wib = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function number(value, digits = 0) {
  if (value === null || value === undefined) return '';
  return value.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function percent(value) {
  return value === null || value === undefined ? '' : `${number(value * 100, 1)}%`;
}

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, { cache: 'no-store', ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}

// Settings

// Whole numbers only: "100.5" or "1e2" becomes NaN and is refused by settingsProblem.
const parseWhole = (text) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

// The admin types a percentage ("11,1" or "11.1"); the setting is a fraction (0.111).
// Rounding to tenths first keeps 11.1 from becoming 0.11099999.
function parsePercent(text) {
  const t = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) / 100 : NaN;
}
const formatPercent = (fraction) => String(Math.round(fraction * 1000) / 10).replace('.', ',');

const settingFields = {
  displayDurationMs: { el: () => $('set-duration'), parse: Number, format: String },
  totalTrials: { el: () => $('set-trials'), parse: parseWhole, format: String },
  targetFrequency: { el: () => $('set-frequency'), parse: parsePercent, format: formatPercent },
  feedbackMode: { el: () => $('set-feedback'), parse: String, format: String },
};
const settingChecks = { trialMode: 'set-trial-mode', randomFontSize: 'set-random-font' };

function fillSettings(s) {
  for (const [key, field] of Object.entries(settingFields)) field.el().value = field.format(s[key]);
  for (const [key, id] of Object.entries(settingChecks)) $(id).checked = s[key];
}

async function loadSettings() {
  $('settings-status').hidden = false;
  $('settings-error').hidden = true;
  $('settings-form').hidden = true;
  try {
    fillSettings(await api('/api/admin/settings'));
    $('settings-status').hidden = true;
    $('settings-form').hidden = false;
  } catch (err) {
    $('settings-status').hidden = true;
    $('settings-error-text').textContent = `Pengaturan tidak bisa dimuat (${err.message}). Periksa koneksi, lalu coba lagi.`;
    $('settings-error').hidden = false;
  }
}

$('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = {};
  for (const [key, id] of Object.entries(settingChecks)) body[key] = $(id).checked;
  for (const [key, field] of Object.entries(settingFields)) body[key] = field.parse(field.el().value);
  const saved = $('settings-saved');
  const problem = settingsProblem(body);
  for (const id of ['set-trials', 'set-frequency']) $(id).removeAttribute('aria-invalid');
  if (problem) {
    const field = /Jumlah angka/.test(problem) ? 'set-trials' : /Proporsi|tidak ada angka 3/.test(problem) ? 'set-frequency' : null;
    if (field) {
      $(field).setAttribute('aria-invalid', 'true');
      $(field).focus();
    }
    saved.className = 'status-error';
    saved.textContent = `Belum disimpan. ${problem}`;
    return;
  }
  saved.className = 'status';
  saved.textContent = 'Menyimpan...';
  try {
    fillSettings(await api('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    saved.textContent = `Tersimpan pukul ${wib.format(new Date()).slice(11, 16)} WIB.`;
  } catch (err) {
    saved.className = 'status-error';
    saved.textContent = `Gagal menyimpan (${err.message}). Coba lagi.`;
  }
});

$('settings-reload').addEventListener('click', loadSettings);

// Overview

const MEAN_ROWS = [
  ['accuracy', 'Akurasi (%)', (v) => number(v, 1)],
  ['correct_hits', 'Hit (respons tepat)', (v) => number(v, 1)],
  ['commission_errors', 'Kesalahan komisi (menekan 3)', (v) => number(v, 1)],
  ['omission_errors', 'Kesalahan omisi (terlewat)', (v) => number(v, 1)],
  ['mean_rt_ms', 'RT rata-rata hit (ms)', (v) => number(v, 0)],
  ['sd_rt_ms', 'SD RT hit (ms)', (v) => number(v, 0)],
  ['rt_cv', 'CV RT', (v) => number(v, 3)],
  ['commission_rate', 'Tingkat komisi', percent],
  ['omission_rate', 'Tingkat omisi', percent],
  ['anticipation_count', 'Antisipasi (< 100 ms)', (v) => number(v, 1)],
];

function chartsAvailable() {
  return typeof window.Chart === 'function';
}

function replaceChart(name, canvas, config) {
  charts[name]?.destroy();
  charts[name] = new window.Chart(canvas, config);
}

// One dot per participant. Dots get a small fixed vertical offset so equal values stay visible.
function stripChart(name, canvas, rows, valueKey, format, axis) {
  const points = rows
    .filter((s) => s[valueKey] !== null)
    .map((s, i) => ({ x: s[valueKey], y: ((i * 7) % 11) / 10 - 0.5, id: s.participant_id_raw }));
  replaceChart(name, canvas, {
    type: 'scatter',
    data: { datasets: [{ data: points, backgroundColor: BLUE, pointRadius: 6, pointHoverRadius: 8, clip: false }] },
    options: {
      maintainAspectRatio: false,
      animation: false,
      // Room for dots that sit exactly on the axis ends, such as 100% accuracy.
      layout: { padding: { left: 8, right: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw.id}: ${format(c.raw.x)}` } },
      },
      scales: {
        x: { ...axis, title: { display: true, text: axis.label, color: '#1d2433' }, ticks: { color: '#1d2433' } },
        y: { display: false, min: -1, max: 1 },
      },
    },
  });
}

function renderOverview() {
  const used = latestCompletedPerParticipant(sessions);
  $('count-participants').textContent = participantCount(sessions);
  $('count-sessions').textContent = realSessionCount(sessions);
  $('count-used').textContent = used.length;
  $('overview-empty').hidden = used.length > 0;
  $('overview-data').hidden = used.length === 0;
  $('overview-status').hidden = true;
  $('overview-body').hidden = false;
  if (used.length === 0) return;

  const means = metricMeans(used);
  $('means-body').replaceChildren(...MEAN_ROWS.map(([key, label, format]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<th scope="row"></th><td class="num"></td><td class="num"></td>';
    tr.children[0].textContent = label;
    tr.children[1].textContent = means[key].mean === null ? 'belum ada' : format(means[key].mean);
    tr.children[2].textContent = means[key].n;
    return tr;
  }));

  if (!chartsAvailable()) {
    for (const id of ['chart-accuracy', 'chart-cv']) {
      $(id).parentElement.textContent = 'Grafik tidak bisa ditampilkan karena Chart.js gagal diunduh. Tabel tetap bisa dipakai.';
    }
    return;
  }
  stripChart('accuracy', $('chart-accuracy'), used, 'accuracy', (v) => `${v}%`, { min: 0, max: 100, label: 'Akurasi (%)' });
  stripChart('cv', $('chart-cv'), used, 'rt_cv', (v) => number(v, 3), { min: 0, label: 'CV RT' });
}

// Sessions table

const COLUMNS = [
  ['created_at', 'Waktu (WIB)', (s) => wib.format(new Date(s.created_at))],
  ['participant_name', 'Nama', (s) => s.participant_name],
  ['participant_id', 'ID', (s) => s.participant_id_raw],
  ['attempt_no', 'Ke-', (s) => s.attempt_no, true],
  ['is_trial', 'Jenis', (s) => (s.is_trial ? 'Latihan' : 'Utama')],
  ['status', 'Status', (s) => (s.status === 'completed' ? 'Selesai' : 'Dihentikan')],
  ['trials_completed', 'Angka', (s) => `${s.trials_completed} / ${s.total_trials}`, true],
  ['accuracy', 'Akurasi', (s) => (s.accuracy === null ? '' : `${s.accuracy}%`), true],
  ['correct_hits', 'Hit', (s) => s.correct_hits, true],
  ['commission_errors', 'Komisi', (s) => s.commission_errors, true],
  ['omission_errors', 'Omisi', (s) => s.omission_errors, true],
  ['mean_rt_ms', 'RT (ms)', (s) => number(s.mean_rt_ms), true],
  ['sd_rt_ms', 'SD RT (ms)', (s) => number(s.sd_rt_ms), true],
  ['rt_cv', 'CV RT', (s) => number(s.rt_cv, 3), true],
  ['anticipation_count', 'Antisipasi', (s) => s.anticipation_count, true],
  ['tab_hidden_count', 'Tab ditinggal', null, true],
  ['input_type', 'Input', (s) => s.input_type],
];

function renderHead() {
  const cells = COLUMNS.map(([key, label, , numeric]) => {
    const th = document.createElement('th');
    th.scope = 'col';
    if (numeric) th.className = 'num';
    if (sort.key === key) th.setAttribute('aria-sort', sort.direction === 'asc' ? 'ascending' : 'descending');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      sort = sort.key === key
        ? { key, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'desc' };
      renderTable();
      document.querySelector(`#sessions-head th:nth-child(${COLUMNS.findIndex((c) => c[0] === key) + 1}) button`).focus();
    });
    th.append(button);
    return th;
  });
  const action = document.createElement('th');
  action.scope = 'col';
  action.innerHTML = '<span class="visually-hidden">Aksi</span>';
  $('sessions-head').replaceChildren(...cells, action);
}

function tabCell(count) {
  const td = document.createElement('td');
  td.className = 'num';
  if (count > 0) {
    const flag = document.createElement('span');
    flag.className = 'flag';
    flag.textContent = `Ya, ${count}x`;
    td.append(flag);
  } else {
    td.textContent = 'Tidak';
  }
  return td;
}

function renderTable() {
  renderHead();
  const filtered = filterSessions(sessions, {
    query: $('filter-query').value,
    status: $('filter-status').value,
    includeTrial: $('filter-trial').checked,
  });
  const rows = sortSessions(filtered, sort.key, sort.direction).map((s) => {
    const tr = document.createElement('tr');
    for (const [key, , format, numeric] of COLUMNS) {
      if (key === 'tab_hidden_count') {
        tr.append(tabCell(s.tab_hidden_count));
        continue;
      }
      const td = document.createElement('td');
      if (numeric) td.className = 'num';
      td.textContent = format(s) ?? '';
      tr.append(td);
    }
    const td = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary';
    button.textContent = 'Lihat RT';
    button.setAttribute('aria-label', `Lihat RT sesi ${s.participant_id_raw} percobaan ke-${s.attempt_no}`);
    button.addEventListener('click', () => openDetail(s));
    td.append(button);
    tr.append(td);
    return tr;
  });

  $('sessions-status').hidden = true;
  $('sessions-body').replaceChildren(...rows);
  $('sessions-wrap').hidden = rows.length === 0;
  $('sessions-empty').hidden = rows.length > 0;
  $('sessions-empty').textContent = sessions.length === 0
    ? 'Belum ada sesi. Sesi muncul di sini setelah partisipan menyelesaikan atau menghentikan tes.'
    : 'Tidak ada sesi yang cocok dengan filter. Ubah pencarian atau centang "Tampilkan sesi latihan".';
}

for (const id of ['filter-query', 'filter-status', 'filter-trial']) {
  $(id).addEventListener('input', renderTable);
}

// Session detail: RT by trial

async function openDetail(s) {
  const detail = $('detail');
  detail.hidden = false;
  $('detail-title').textContent = `Detail sesi ${s.participant_id_raw}, percobaan ke-${s.attempt_no}`;
  $('detail-summary').textContent = `${s.participant_name}. ${s.is_trial ? 'Latihan' : 'Utama'}, `
    + `${s.status === 'completed' ? 'selesai' : 'dihentikan'}. Pengaturan: ${s.display_duration_ms} ms, `
    + `${s.total_trials} angka, ${formatPercent(s.target_frequency)}% angka 3, `
    + `ukuran angka ${s.random_font_size ? 'acak' : 'tetap'}.`;
  $('detail-status').className = 'status';
  $('detail-status').textContent = 'Memuat data per angka...';
  $('detail-status').hidden = false;
  $('detail-figure').hidden = true;
  detail.focus();

  let trials;
  try {
    trials = await api(`/api/admin/sessions/${s.id}/trials`);
  } catch (err) {
    $('detail-status').className = 'status-error';
    $('detail-status').textContent = `Data per angka tidak bisa dimuat (${err.message}). Tutup lalu buka lagi detail ini.`;
    return;
  }
  if (trials.length === 0) {
    $('detail-status').textContent = 'Sesi ini dihentikan sebelum ada angka yang selesai, jadi tidak ada yang bisa digambar.';
    return;
  }
  if (!chartsAvailable()) {
    $('detail-status').textContent = 'Grafik tidak bisa ditampilkan karena Chart.js gagal diunduh.';
    return;
  }
  $('detail-status').hidden = true;
  $('detail-figure').hidden = false;
  // The y-axis spans the whole response window. Misses and correct withholds have no RT,
  // so they sit in a band below 0 ms where they cannot be mistaken for very fast presses.
  const windowMs = s.display_duration_ms + 200;
  const missRow = -0.06 * windowMs;
  const points = (outcome) => trials.filter((t) => t.outcome === outcome)
    .map((t) => ({ x: t.trial_no, y: t.rt_ms ?? missRow }));
  replaceChart('rt', $('chart-rt'), {
    type: 'scatter',
    data: {
      datasets: [
        { label: 'Hit (angka selain 3)', data: points('hit'), backgroundColor: BLUE, pointStyle: 'circle', pointRadius: 4, clip: false },
        { label: 'Komisi (menekan 3)', data: points('commission'), backgroundColor: RED, pointStyle: 'triangle', pointRadius: 6, clip: false },
        { label: 'Terlewat (tanpa RT)', data: points('omission'), borderColor: INK, backgroundColor: INK, borderWidth: 2, pointStyle: 'crossRot', pointRadius: 6, clip: false },
        // A ring, not a filled dot, so it differs from hits by shape as well as colour.
        { label: 'Menahan 3 dengan benar (tanpa RT)', data: points('withhold'), borderColor: GREEN, backgroundColor: 'transparent', borderWidth: 2.5, pointStyle: 'circle', pointRadius: 5, clip: false },
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      // Points on the first and last trial sit on the axis ends; leave room so they are not cut.
      layout: { padding: { left: 8, right: 12, top: 8 } },
      plugins: {
        legend: { labels: { color: INK, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (c) => {
              if (c.datasetIndex === 2) return `Angka ke-${c.raw.x}: terlewat`;
              if (c.datasetIndex === 3) return `Angka ke-${c.raw.x}: angka 3, ditahan dengan benar`;
              return `Angka ke-${c.raw.x}: ${number(c.raw.y)} ms`;
            },
          },
        },
      },
      scales: {
        x: { min: 1, max: s.total_trials, title: { display: true, text: 'Angka ke-', color: INK }, ticks: { color: INK } },
        y: {
          min: 2 * missRow,
          max: windowMs,
          title: { display: true, text: 'RT (ms)', color: INK },
          // No negative tick labels: the band below 0 only holds trials without an RT.
          ticks: { color: INK, callback: (v) => (v < 0 ? '' : v) },
        },
      },
    },
  });
}

$('detail-close').addEventListener('click', () => {
  $('detail').hidden = true;
  charts.rt?.destroy();
  delete charts.rt;
  $('sessions-title').focus();
});
$('sessions-title').tabIndex = -1;

// Data loading

async function loadSessions() {
  $('data-error').hidden = true;
  $('sessions-status').hidden = false;
  $('overview-status').hidden = false;
  try {
    sessions = await api('/api/admin/sessions?include_trial=1');
  } catch (err) {
    $('sessions-status').hidden = true;
    $('overview-status').textContent = 'Ringkasan belum bisa dimuat.';
    $('data-error-text').textContent = `Data sesi tidak bisa dimuat (${err.message}). Periksa koneksi, lalu coba lagi.`;
    $('data-error').hidden = false;
    return;
  }
  renderOverview();
  renderTable();
}

$('data-reload').addEventListener('click', loadSessions);

// CSV links

$('export-trial').addEventListener('change', () => {
  const suffix = $('export-trial').checked ? '?include_trial=1' : '';
  $('export-sessions').href = `${API_BASE}/api/admin/export/sessions.csv${suffix}`;
  $('export-trials').href = `${API_BASE}/api/admin/export/trials.csv${suffix}`;
});

loadSettings();
loadSessions();
