// CSV export helpers. Pure functions.

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Asia/Jakarta has no daylight saving, so a fixed +07:00 offset is exact.
export function toWib(isoUtc) {
  if (!isoUtc) return '';
  const shifted = new Date(Date.parse(isoUtc) + WIB_OFFSET_MS).toISOString();
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 19)}`;
}

function cell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

const col = (key) => ({ header: key, value: (row) => row[key] });
const wibCol = (key) => ({ header: `${key}_wib`, value: (row) => toWib(row[key]) });

export const SESSION_COLUMNS = [
  col('id'), wibCol('created_at'), col('participant_id'), col('participant_id_raw'),
  col('participant_name'), col('attempt_no'), col('is_trial'), col('status'), wibCol('consent_at'),
  col('display_duration_ms'), col('total_trials'), col('target_frequency'), col('trials_completed'),
  col('correct_hits'), col('commission_errors'), col('omission_errors'), col('correct_withholds'),
  col('accuracy'), col('mean_rt_ms'), col('sd_rt_ms'), col('rt_cv'), col('commission_rate'),
  col('omission_rate'), col('anticipation_count'), col('user_agent'), col('screen_width'),
  col('screen_height'), col('input_type'), col('tab_hidden_count'), col('feedback_mode'),
];

export const TRIAL_COLUMNS = [
  col('session_id'), col('participant_id'), col('attempt_no'), col('is_trial'), col('status'),
  col('feedback_mode'),
  col('trial_no'), col('digit'), col('is_target'), col('responded'), col('rt_ms'), col('outcome'),
  col('extra_presses'),
];
