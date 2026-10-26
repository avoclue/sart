import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  participantCount, realSessionCount, latestCompletedPerParticipant, missingSets, metricMeans,
  filterSessions, sortSessions,
} from '../public/js/dashboard.js';

function session(overrides) {
  return {
    participant_id: 'p01', participant_id_raw: 'P01', set_code: 'a', participant_name: 'Budi', is_trial: 0, status: 'completed',
    created_at: '2026-10-25T01:00:00.000Z', accuracy: 80, mean_rt_ms: 350, ...overrides,
  };
}

const sessions = [
  session({ id: 'a' }),
  session({ id: 'b', created_at: '2026-10-25T03:00:00.000Z', accuracy: 90 }),
  session({ id: 'c', created_at: '2026-10-25T05:00:00.000Z', status: 'aborted', accuracy: 10 }),
  session({ id: 'd', created_at: '2026-10-25T06:00:00.000Z', is_trial: 1, accuracy: 50 }),
  session({ id: 'e', participant_id: 'p02', participant_name: 'Sari', accuracy: 70, mean_rt_ms: null }),
  session({ id: 'f', participant_id: 'p03', participant_name: 'Ani', is_trial: 1 }),
];

test('participant and session counts use real sessions only', () => {
  assert.equal(participantCount(sessions), 2);
  assert.equal(realSessionCount(sessions), 4);
});

test('latest completed real session per participant skips aborted and practice', () => {
  const ids = latestCompletedPerParticipant(sessions).map((s) => s.id).sort();
  assert.deepEqual(ids, ['b', 'e']);
});

test('metricMeans skips empty values and reports n per metric', () => {
  const means = metricMeans(latestCompletedPerParticipant(sessions));
  assert.deepEqual(means.accuracy, { n: 2, mean: 80 });
  assert.deepEqual(means.mean_rt_ms, { n: 1, mean: 350 });
  assert.deepEqual(metricMeans([]).accuracy, { n: 0, mean: null });
});

test('filterSessions matches name or ID and hides practice by default', () => {
  assert.equal(filterSessions(sessions).length, 4);
  assert.equal(filterSessions(sessions, { includeTrial: true }).length, 6);
  assert.deepEqual(filterSessions(sessions, { query: 'SAR' }).map((s) => s.id), ['e']);
  assert.deepEqual(filterSessions(sessions, { query: 'p02' }).map((s) => s.id), ['e']);
  assert.deepEqual(filterSessions(sessions, { status: 'aborted' }).map((s) => s.id), ['c']);
});

test('sortSessions sorts both ways and keeps empty values last', () => {
  assert.deepEqual(sortSessions(sessions, 'accuracy', 'asc').map((s) => s.id), ['c', 'd', 'e', 'a', 'f', 'b']);
  assert.deepEqual(sortSessions(sessions, 'mean_rt_ms', 'desc').at(-1).id, 'e');
  assert.deepEqual(sortSessions(sessions, 'mean_rt_ms', 'asc').at(-1).id, 'e');
});

test('the latest completed session is kept per participant and per set', () => {
  const withB = [...sessions, session({ id: 'g', set_code: 'b', created_at: '2026-10-25T09:00:00.000Z' })];
  const ids = latestCompletedPerParticipant(withB).map((s) => s.id).sort();
  assert.deepEqual(ids, ['b', 'e', 'g']);
});

test('filterSessions keeps one set when asked', () => {
  const withB = [...sessions, session({ id: 'g', set_code: 'b' })];
  assert.deepEqual(filterSessions(withB, { set: 'b' }).map((s) => s.id), ['g']);
  assert.equal(filterSessions(withB, { set: 'all' }).length, 5);
});

test('missingSets lists participants without a completed main session in every active set', () => {
  const rows = [
    session({ id: '1', set_code: 'a' }),
    session({ id: '2', set_code: 'b' }),
    session({ id: '3', participant_id: 'p02', participant_id_raw: 'P02', set_code: 'a' }),
    // Aborted, practice and inactive-set sessions do not count as done.
    session({ id: '4', participant_id: 'p02', participant_id_raw: 'P02', set_code: 'b', status: 'aborted' }),
    session({ id: '5', participant_id: 'p02', participant_id_raw: 'P02', set_code: 'b', is_trial: 1 }),
    session({ id: '6', participant_id: 'p03', participant_id_raw: 'P03', set_code: 'old' }),
  ];
  assert.deepEqual(missingSets(rows, ['a', 'b']), [{ participantId: 'P02', missing: ['b'] }]);
  assert.deepEqual(missingSets(rows, ['a', 'b', 'c']), [
    { participantId: 'P01', missing: ['c'] },
    { participantId: 'P02', missing: ['b', 'c'] },
  ]);
});
