// Admin dashboard data helpers. Pure functions over session rows from /api/admin/sessions.

export const METRIC_KEYS = [
  'accuracy', 'correct_hits', 'commission_errors', 'omission_errors', 'mean_rt_ms', 'sd_rt_ms',
  'rt_cv', 'commission_rate', 'omission_rate', 'anticipation_count', 'early_count',
];

const isReal = (s) => s.is_trial === 0;

// Distinct participant IDs over real sessions (PLAN.md §9 D12).
export function participantCount(sessions) {
  return new Set(sessions.filter(isReal).map((s) => s.participant_id)).size;
}

export function realSessionCount(sessions) {
  return sessions.filter(isReal).length;
}

// Each participant is represented by their latest completed real session in each test set
// (PLAN.md §9 D23, D38), so a session in set B does not replace one in set A.
export function latestCompletedPerParticipant(sessions) {
  const latest = new Map();
  for (const s of sessions) {
    if (!isReal(s) || s.status !== 'completed') continue;
    const key = `${s.set_code ?? ''}\n${s.participant_id}`;
    const current = latest.get(key);
    if (!current || s.created_at > current.created_at) latest.set(key, s);
  }
  return [...latest.values()];
}

// Participants with a completed main session in some active sets but not all of them
// (PLAN.md §9 D38), with the codes they are missing. Sorted by participant ID.
export function missingSets(sessions, activeCodes) {
  const done = new Map();
  for (const s of sessions) {
    if (!isReal(s) || s.status !== 'completed' || !activeCodes.includes(s.set_code)) continue;
    if (!done.has(s.participant_id)) done.set(s.participant_id, { id: s.participant_id_raw, codes: new Set() });
    done.get(s.participant_id).codes.add(s.set_code);
  }
  return [...done.entries()]
    .map(([key, { id, codes }]) => ({ key, participantId: id, missing: activeCodes.filter((c) => !codes.has(c)) }))
    .filter((p) => p.missing.length > 0)
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map(({ participantId, missing }) => ({ participantId, missing }));
}

// Mean of each metric over the given sessions, skipping empty values. n is per metric.
export function metricMeans(sessions) {
  const means = {};
  for (const key of METRIC_KEYS) {
    const values = sessions.map((s) => s[key]).filter((v) => v !== null && v !== undefined);
    means[key] = {
      n: values.length,
      mean: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null,
    };
  }
  return means;
}

// Text matches name or participant ID, case-insensitive. set is a set code or 'all'.
export function filterSessions(sessions, { query = '', status = 'all', includeTrial = false, set = 'all' } = {}) {
  const q = query.trim().toLowerCase();
  return sessions.filter((s) => (includeTrial || isReal(s))
    && (set === 'all' || s.set_code === set)
    && (status === 'all' || s.status === status)
    && (q === '' || s.participant_name.toLowerCase().includes(q) || s.participant_id.includes(q)));
}

// Empty values sort last in both directions.
export function sortSessions(sessions, key, direction = 'desc') {
  const sign = direction === 'asc' ? 1 : -1;
  return [...sessions].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (x < y ? -1 : 1) * sign;
  });
}
