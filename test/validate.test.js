import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResult, validateAdminSettings, ValidationError } from '../src/validate.js';
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
    isTrial: false,
    status: 'completed',
    consentAt: '2026-10-25T10:00:00.000Z',
    settings: { displayDurationMs: 500, totalTrials: 50, targetFrequency: 0.1 },
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

test('rejects settings outside the allowed options', () => {
  const settings = { displayDurationMs: 300, totalTrials: 50, targetFrequency: 0.1 };
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

test('rejects out-of-order trial numbers', () => {
  const trials = trialsFor(digits);
  trials[1].trialNo = 5;
  assert.throws(() => validateResult(body({ trials })), ValidationError);
});

test('admin settings need a boolean trialMode', () => {
  const s = { displayDurationMs: 250, totalTrials: 200, targetFrequency: 0.3 };
  assert.deepEqual(validateAdminSettings({ ...s, trialMode: true }), { ...s, trialMode: true });
  assert.throws(() => validateAdminSettings({ ...s, trialMode: 1 }), ValidationError);
});

test('toWib converts UTC to Asia/Jakarta time', () => {
  assert.equal(toWib('2026-10-25T20:30:00.000Z'), '2026-10-26 03:30:00');
  assert.equal(toWib(null), '');
});

test('toCsv quotes cells with commas, quotes and newlines', () => {
  const out = toCsv([{ header: 'a', value: (r) => r.a }], [{ a: 'x, "y"' }, { a: null }]);
  assert.equal(out, 'a\r\n"x, ""y"""\r\n\r\n');
});
