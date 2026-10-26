import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResult, validateAdminSettings, validateSet, ValidationError } from '../src/validate.js';
import { toCsv, toWib } from '../src/csv.js';

function trialsFor(digits, rtMs = 300) {
  return digits.map((digit, i) => ({
    trialNo: i + 1, digit, responded: digit !== 3, rtMs: digit !== 3 ? rtMs : null, extraPresses: 0,
  }));
}

// 50 trials at 10% = 5 targets.
const digits = [...Array(5).fill(3), ...Array(45).fill(5)];

function body(overrides = {}) {
  return {
    participantName: ' Budi ',
    participantId: ' P01 ',
    setCode: 'a',
    status: 'completed',
    sessionKind: 'main',
    practiceNo: null,
    visitId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    consentAt: '2026-10-25T10:00:00.000Z',
    settings: { displayDurationMs: 500, totalTrials: 50, targetFrequency: 0.1, randomFontSize: false, balancedDigits: false, maskMs: 0, responseMode: 'classic' },
    device: { screenWidth: 1280, screenHeight: 800, inputType: 'keyboard' },
    tabHiddenCount: 0,
    trials: trialsFor(digits),
    ...overrides,
  };
}

test('a valid completed session passes and is normalised', () => {
  const r = validateResult(body());
  assert.equal(r.participantName, 'Budi');
  assert.equal(r.participantIdRaw, 'P01');
  assert.equal(r.participantId, 'p01');
  assert.equal(r.trials.length, 50);
  assert.equal(r.trials[0].outcome, 'withhold');
  assert.equal(r.trials[5].outcome, 'hit');
});

test('outcomes are recomputed, not taken from the browser', () => {
  const trials = trialsFor(digits).map((t) => ({ ...t, outcome: 'hit' }));
  const r = validateResult(body({ trials }));
  assert.equal(r.trials[0].outcome, 'withhold');
});

test('rejects missing name or ID', () => {
  assert.throws(() => validateResult(body({ participantName: '  ' })), ValidationError);
  assert.throws(() => validateResult(body({ participantId: undefined })), ValidationError);
});

test('rejects settings outside the allowed ranges', () => {
  const settings = { displayDurationMs: 50, totalTrials: 50, targetFrequency: 0.1, randomFontSize: false, balancedDigits: false, maskMs: 0, responseMode: 'classic' };
  assert.throws(() => validateResult(body({ settings })), ValidationError);
});

test('completed sessions need every trial and the exact target count', () => {
  assert.throws(() => validateResult(body({ trials: trialsFor(digits.slice(0, 49)) })), ValidationError);
  assert.throws(() => validateResult(body({ trials: trialsFor(Array(50).fill(5)) })), ValidationError);
});

test('aborted sessions may have fewer trials, including none', () => {
  assert.equal(validateResult(body({ status: 'aborted', trials: trialsFor(digits.slice(0, 10)) })).trials.length, 10);
  assert.equal(validateResult(body({ status: 'aborted', trials: [] })).trials.length, 0);
});

test('rejects RTs outside the response window and inconsistent presses', () => {
  assert.throws(() => validateResult(body({ trials: trialsFor(digits, 5000) })), ValidationError);
  const trials = trialsFor(digits);
  trials[0] = { ...trials[0], rtMs: 200 };
  assert.throws(() => validateResult(body({ trials })), ValidationError);
});

test('font sizes must match the randomFontSize setting', () => {
  const on = { displayDurationMs: 500, totalTrials: 50, targetFrequency: 0.1, randomFontSize: true, balancedDigits: false, maskMs: 0, responseMode: 'classic' };
  const sized = trialsFor(digits).map((t, i) => ({ ...t, fontSizePt: [48, 72, 94, 100, 120][i % 5] }));
  assert.equal(validateResult(body({ settings: on, trials: sized })).trials[1].fontSizePt, 72);
  assert.throws(() => validateResult(body({ settings: on })), ValidationError);
  assert.throws(() => validateResult(body({ trials: sized })), ValidationError);
  const odd = sized.map((t) => ({ ...t, fontSizePt: 60 }));
  assert.throws(() => validateResult(body({ settings: on, trials: odd })), ValidationError);
  assert.equal(validateResult(body()).trials[0].fontSizePt, null);
});

test('font colors must match the randomFontColor setting and be balanced', () => {
  const on = { displayDurationMs: 500, totalTrials: 50, targetFrequency: 0.1, randomFontSize: false, randomFontColor: true, balancedDigits: false, maskMs: 0, responseMode: 'classic' };
  // 50 trials over 3 colors: 17, 17 and 16.
  const cycle = ['red', 'yellow', 'blue'];
  const colored = trialsFor(digits).map((t, i) => ({ ...t, fontColor: cycle[i % 3] }));
  assert.equal(validateResult(body({ settings: on, trials: colored })).trials[1].fontColor, 'yellow');
  assert.throws(() => validateResult(body({ settings: on })), ValidationError);
  assert.throws(() => validateResult(body({ trials: colored })), ValidationError);
  const green = colored.map((t) => ({ ...t, fontColor: 'green' }));
  assert.throws(() => validateResult(body({ settings: on, trials: green })), /fontColor/);
  const lopsided = colored.map((t, i) => ({ ...t, fontColor: i < 30 ? 'red' : 'blue' }));
  assert.throws(() => validateResult(body({ settings: on, trials: lopsided })), /balanced/);
  const partial = colored.slice(0, 20);
  assert.equal(validateResult(body({ settings: on, status: 'aborted', trials: partial })).trials.length, 20);
  assert.equal(validateResult(body()).trials[0].fontColor, null);
});

test('balanced sessions must have the non-3 digits equally often', () => {
  const on = { displayDurationMs: 500, totalTrials: 50, targetFrequency: 0.1, randomFontSize: false, balancedDigits: true, maskMs: 0, responseMode: 'classic' };
  // 45 non-3 digits over 8 digits: five appear 6 times and three appear 5 times.
  const balanced = [...Array(5).fill(3), ...[1, 2, 4, 5, 6, 7, 8, 9].flatMap((d, i) => Array(i < 5 ? 6 : 5).fill(d))];
  assert.equal(validateResult(body({ settings: on, trials: trialsFor(balanced) })).trials.length, 50);
  assert.throws(() => validateResult(body({ settings: on })), ValidationError);
  assert.equal(validateResult(body({ settings: on, status: 'aborted', trials: trialsFor(balanced.slice(0, 20)) })).trials.length, 20);
  assert.throws(() => validateResult(body({ settings: on, status: 'aborted', trials: trialsFor(Array(7).fill(5)) })), ValidationError);
});

test('rejects out-of-order trial numbers', () => {
  const trials = trialsFor(digits);
  trials[1].trialNo = 5;
  assert.throws(() => validateResult(body({ trials })), ValidationError);
});

test('admin settings need a boolean trialMode and a known feedbackMode', () => {
  const s = { displayDurationMs: 250, totalTrials: 200, targetFrequency: 0.3, randomFontSize: true, randomFontColor: true, balancedDigits: false, maskMs: 0, responseMode: 'classic' };
  const full = { ...s, trialMode: true, feedbackMode: 'errors', practiceSessions: 2, practiceTrials: 18 };
  assert.deepEqual(validateAdminSettings(full), full);
  assert.throws(() => validateAdminSettings({ ...full, trialMode: 1 }), ValidationError);
  assert.throws(() => validateAdminSettings({ ...full, feedbackMode: 'some' }), ValidationError);
  assert.throws(() => validateAdminSettings({ ...full, practiceSessions: 0 }), /minimal 1 sesi latihan/);
  assert.throws(() => validateAdminSettings({ ...full, practiceTrials: 9 }), /angka per sesi latihan/);
  assert.throws(() => validateAdminSettings({ ...full, maskMs: 0, responseMode: 'wait_mask' }), /butuh mask/);
});

test('the set code is required and normalised', () => {
  assert.equal(validateResult(body({ setCode: ' B-2 ' })).setCode, 'b-2');
  assert.throws(() => validateResult(body({ setCode: undefined })), /invalid setCode/);
  assert.throws(() => validateResult(body({ setCode: '' })), /invalid setCode/);
  assert.throws(() => validateResult(body({ setCode: 'set b' })), /invalid setCode/);
  assert.throws(() => validateResult(body({ setCode: 'x'.repeat(21) })), /invalid setCode/);
});

test('a test set needs a valid code, a label and a boolean isActive', () => {
  const settings = { displayDurationMs: 250, totalTrials: 225, targetFrequency: 0.111, randomFontSize: true, randomFontColor: false, balancedDigits: true, maskMs: 900, responseMode: 'classic', trialMode: false, feedbackMode: 'errors', practiceSessions: 1, practiceTrials: 18 };
  const set = { ...settings, code: ' B ', label: ' Set B ', isActive: true };
  assert.deepEqual(validateSet(set), { ...settings, code: 'b', label: 'Set B', isActive: true });
  assert.throws(() => validateSet({ ...set, code: '' }), /Kode set wajib/);
  assert.throws(() => validateSet({ ...set, code: 'b_2' }), /Kode set hanya/);
  assert.throws(() => validateSet({ ...set, label: '  ' }), /Label set wajib/);
  assert.throws(() => validateSet({ ...set, label: 'x'.repeat(61) }), /Label set paling banyak/);
  assert.throws(() => validateSet({ ...set, isActive: 'yes' }), /isActive/);
  assert.throws(() => validateSet({ ...set, practiceTrials: 5 }), /angka per sesi latihan/);
});

test('toWib converts UTC to Asia/Jakarta time', () => {
  assert.equal(toWib('2026-10-25T20:30:00.000Z'), '2026-10-26 03:30:00');
  assert.equal(toWib(null), '');
});

test('toCsv quotes cells with commas, quotes and newlines', () => {
  const out = toCsv([{ header: 'a', value: (r) => r.a }], [{ a: 'x, "y"' }, { a: null }]);
  assert.equal(out, 'a\r\n"x, ""y"""\r\n\r\n');
});

test('practice and main sessions carry their kind, practice number and visit', () => {
  const practice = validateResult(body({ sessionKind: 'practice', practiceNo: 2 }));
  assert.equal(practice.sessionKind, 'practice');
  assert.equal(practice.practiceNo, 2);
  assert.equal(validateResult(body()).practiceNo, null);
  assert.throws(() => validateResult(body({ sessionKind: 'practice', practiceNo: 0 })), /practiceNo/);
  assert.throws(() => validateResult(body({ sessionKind: 'practice', practiceNo: 6 })), /practiceNo/);
  assert.throws(() => validateResult(body({ practiceNo: 1 })), /main session has no practiceNo/);
  assert.throws(() => validateResult(body({ sessionKind: 'trial' })), /sessionKind/);
  assert.throws(() => validateResult(body({ visitId: 'abc' })), /visitId/);
});

test('mask widens the RT window; wait_mask allows negative RTs and scores them early', () => {
  const masked = { displayDurationMs: 250, totalTrials: 50, targetFrequency: 0.1, randomFontSize: false, balancedDigits: false, maskMs: 900, responseMode: 'classic' };
  assert.equal(validateResult(body({ settings: masked, trials: trialsFor(digits, 1100) })).trials[5].outcome, 'hit');
  assert.throws(() => validateResult(body({ settings: masked, trials: trialsFor(digits, 1300) })), /rtMs/);
  assert.throws(() => validateResult(body({ settings: masked, trials: trialsFor(digits, -10) })), /rtMs/);

  const wait = { ...masked, responseMode: 'wait_mask' };
  const trials = trialsFor(digits, 300);
  trials[5] = { ...trials[5], rtMs: -120 };
  const r = validateResult(body({ settings: wait, trials }));
  assert.equal(r.trials[5].outcome, 'early');
  assert.equal(r.trials[6].outcome, 'hit');
  assert.throws(() => validateResult(body({ settings: wait, trials: trialsFor(digits, -300) })), /rtMs/);
  assert.equal(validateResult(body({ settings: wait, trials: trialsFor(digits, 1000) })).trials[5].outcome, 'hit');
  assert.throws(() => validateResult(body({ settings: wait, trials: trialsFor(digits, 1100) })), /rtMs/);
  assert.throws(() => validateResult(body({ settings: { ...wait, maskMs: 0 } })), /butuh mask/);
});

test('session start and duration are optional but checked when sent', () => {
  const none = validateResult(body());
  assert.equal(none.startedAt, null);
  assert.equal(none.durationMs, null);
  const r = validateResult(body({ startedAt: '2026-10-26T03:00:00.000Z', durationMs: 305_420 }));
  assert.equal(r.startedAt, '2026-10-26T03:00:00.000Z');
  assert.equal(r.durationMs, 305_420);
  assert.throws(() => validateResult(body({ startedAt: 'yesterday', durationMs: 1000 })), ValidationError);
  assert.throws(() => validateResult(body({ startedAt: '2026-10-26T03:00:00.000Z' })), ValidationError);
  assert.throws(() => validateResult(body({ startedAt: '2026-10-26T03:00:00.000Z', durationMs: -1 })), ValidationError);
  assert.throws(() => validateResult(body({ startedAt: '2026-10-26T03:00:00.000Z', durationMs: 1.5 })), ValidationError);
  assert.throws(() => validateResult(body({ startedAt: '2026-10-26T03:00:00.000Z', durationMs: 90_000_000 })), ValidationError);
});
