import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TARGET_DIGIT, targetCount, generateSequence, responseWindowMs,
  createTrial, registerPress, scoreTrial, summarize,
  feedbackFor, estimateMinutes, combineInputTypes, settingsProblem, balancedCounts, NON_TARGET_DIGITS,
  adminSettingsProblem, practiceChoices, afterDigitMs, cueOffsetMs, outcomeOf, isAnticipation, FONT_SIZES_PT, generateFontSizes, fontScale,
} from '../public/js/sart.js';

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

function scored(digit, rtMs = null) {
  let trial = createTrial(1, digit);
  if (rtMs !== null) trial = registerPress(trial, rtMs);
  return scoreTrial(trial);
}

test('targetCount gives the reference counts for its own options', () => {
  for (const n of [50, 100, 200]) for (const f of [0.1, 0.2, 0.3]) assert.equal(targetCount(n, f), Math.round(n * f));
  assert.equal(targetCount(100, 0.29), 29);
});

test('targetCount rounds to the nearest whole number, halves up', () => {
  assert.equal(targetCount(225, 0.111), 25);
  assert.equal(targetCount(225, 0.11), 25);
  assert.equal(targetCount(225, 0.109), 25);
  assert.equal(targetCount(10, 0.15), 2);
  assert.equal(targetCount(10, 0.14), 1);
  assert.equal(targetCount(10, 0.04), 0);
});

test('generateSequence has the exact number of targets and only valid digits', () => {
  for (const [n, f] of [[50, 0.1], [100, 0.2], [200, 0.3]]) {
    const seq = generateSequence(n, f, { random: seededRandom(n) });
    assert.equal(seq.length, n);
    assert.equal(seq.filter((d) => d === TARGET_DIGIT).length, targetCount(n, f));
    assert.ok(seq.every((d) => Number.isInteger(d) && d >= 1 && d <= 9));
  }
});

test('generateSequence shuffles the targets', () => {
  const seq = generateSequence(100, 0.2, { random: seededRandom(7) });
  assert.notDeepEqual(seq.slice(0, 20), Array(20).fill(TARGET_DIGIT));
});

test('response window is the digit plus the blank, or plus the mask when there is one', () => {
  assert.equal(responseWindowMs(250), 450);
  assert.equal(responseWindowMs(250, 0), 450);
  assert.equal(responseWindowMs(250, 900), 1150);
  assert.equal(responseWindowMs(500, 1150), 1650);
  assert.equal(afterDigitMs(0), 200);
  assert.equal(afterDigitMs(500), 500);
});

test('each trial gets exactly one outcome', () => {
  assert.equal(scored(5, 320).outcome, 'hit');
  assert.equal(scored(5).outcome, 'omission');
  assert.equal(scored(3, 320).outcome, 'commission');
  assert.equal(scored(3).outcome, 'withhold');
});

test('a late press in the blank is a single hit, not a hit plus an omission', () => {
  // 250 ms display: a 400 ms press lands in the blank but inside the window.
  const summary = summarize([scored(5, 400)]);
  assert.equal(summary.correctHits, 1);
  assert.equal(summary.omissionErrors, 0);
});

test('only the first press sets the RT; later presses are counted', () => {
  let trial = createTrial(1, 5);
  trial = registerPress(trial, 300);
  trial = registerPress(trial, 350);
  trial = registerPress(trial, 400);
  assert.equal(trial.rtMs, 300);
  assert.equal(trial.extraPresses, 2);
});

test('registerPress does not mutate its input', () => {
  const trial = createTrial(1, 5);
  registerPress(trial, 300);
  assert.equal(trial.responded, false);
});

test('summarize computes the reference metrics', () => {
  const trials = [scored(5, 300), scored(6, 400), scored(7), scored(3, 250), scored(3)];
  const s = summarize(trials);
  assert.equal(s.correctHits, 2);
  assert.equal(s.omissionErrors, 1);
  assert.equal(s.commissionErrors, 1);
  assert.equal(s.correctWithholds, 1);
  assert.equal(s.accuracy, 60);
  assert.equal(s.commissionRate, 0.5);
  assert.equal(s.omissionRate, 1 / 3);
});

test('RT metrics use correct hits only, with sample SD', () => {
  const s = summarize([scored(5, 300), scored(6, 400), scored(3, 100)]);
  assert.equal(s.meanRtMs, 350);
  assert.equal(s.sdRtMs, Math.sqrt(5000));
  assert.equal(s.rtCv, Math.sqrt(5000) / 350);
});

test('anticipations count on all trials, are scored normally and excluded from RT', () => {
  const s = summarize([scored(5, 50), scored(3, 80), scored(6, 300), scored(7, 500)]);
  assert.equal(s.anticipationCount, 2);
  assert.equal(s.correctHits, 3);
  assert.equal(s.commissionErrors, 1);
  assert.equal(s.meanRtMs, 400);
});

test('metrics with an empty denominator are null', () => {
  const none = summarize([]);
  assert.equal(none.accuracy, null);
  assert.equal(none.meanRtMs, null);
  assert.equal(none.commissionRate, null);
  assert.equal(none.omissionRate, null);
  const oneHit = summarize([scored(5, 300)]);
  assert.equal(oneHit.meanRtMs, 300);
  assert.equal(oneHit.sdRtMs, null);
  assert.equal(oneHit.rtCv, null);
});

test('accuracy of an aborted session uses trials completed', () => {
  const s = summarize([scored(5, 300), scored(5)]);
  assert.equal(s.trialsCompleted, 2);
  assert.equal(s.accuracy, 50);
});

test('feedbackFor follows the feedback mode', () => {
  assert.equal(feedbackFor('commission', 'off'), null);
  assert.equal(feedbackFor('omission', 'off'), null);
  assert.equal(feedbackFor('commission', 'errors'), 'commission');
  assert.equal(feedbackFor('omission', 'errors'), 'omission');
  assert.equal(feedbackFor('hit', 'errors'), null);
  assert.equal(feedbackFor('withhold', 'errors'), null);
  assert.equal(feedbackFor('hit', 'all'), 'correct');
  assert.equal(feedbackFor('withhold', 'all'), 'correct');
  assert.equal(feedbackFor('omission', 'all'), 'omission');
});

test('estimateMinutes rounds the test length up, countdown and mask included', () => {
  assert.equal(estimateMinutes({ displayDurationMs: 500, totalTrials: 100 }), 2);
  assert.equal(estimateMinutes({ displayDurationMs: 250, totalTrials: 50 }), 1);
  assert.equal(estimateMinutes({ displayDurationMs: 750, totalTrials: 200 }), 4);
  // Classic SART: 3 s countdown + 225 x 1150 ms = 261.75 s
  assert.equal(estimateMinutes({ displayDurationMs: 250, totalTrials: 225, maskMs: 900 }), 5);
});

test('combineInputTypes reports none, a single type or mixed', () => {
  assert.equal(combineInputTypes([]), 'none');
  assert.equal(combineInputTypes(['keyboard', 'keyboard']), 'keyboard');
  assert.equal(combineInputTypes(['keyboard', 'touch']), 'mixed');
});

test('generateFontSizes draws only Robertson sizes, and all of them over many trials', () => {
  const sizes = generateFontSizes(200, seededRandom(3));
  assert.equal(sizes.length, 200);
  assert.ok(sizes.every((s) => FONT_SIZES_PT.includes(s)));
  assert.deepEqual([...new Set(sizes)].sort((a, b) => a - b), FONT_SIZES_PT);
});

test('fontScale is relative to the largest size', () => {
  assert.equal(fontScale(120), 1);
  assert.equal(fontScale(48), 0.4);
});

test('settingsProblem accepts free-text values inside the limits', () => {
  const ok = { displayDurationMs: 250, totalTrials: 225, targetFrequency: 0.111 };
  assert.equal(settingsProblem(ok), null);
  assert.equal(settingsProblem({ ...ok, totalTrials: 10, targetFrequency: 0.1 }), null);
  assert.equal(settingsProblem({ ...ok, totalTrials: 500, targetFrequency: 0.5 }), null);
  assert.equal(settingsProblem({ ...ok, targetFrequency: 0.01 }), null);
});

test('settingsProblem rejects decimals in trials, extra decimals in percent and out-of-range values', () => {
  const ok = { displayDurationMs: 500, totalTrials: 100, targetFrequency: 0.2 };
  for (const totalTrials of [9, 501, 100.5, '100', NaN]) assert.match(settingsProblem({ ...ok, totalTrials }), /bilangan bulat/);
  for (const targetFrequency of [0.009, 0.501, 0.1115, '0.2', NaN]) assert.match(settingsProblem({ ...ok, targetFrequency }), /Proporsi/);
  assert.match(settingsProblem({ ...ok, displayDurationMs: 300 }), /Durasi/);
  assert.match(settingsProblem({ ...ok, totalTrials: 10, targetFrequency: 0.04 }), /tidak ada angka 3/);
  assert.equal(settingsProblem({ ...ok, totalTrials: 10, targetFrequency: 0.05 }), null);
});

const countsOf = (seq) => new Map(NON_TARGET_DIGITS.map((d) => [d, seq.filter((x) => x === d).length]));

test('balanced sequence at 225 and 11.1% is classic SART: every digit 25 times', () => {
  const seq = generateSequence(225, 0.111, { balanced: true, random: seededRandom(11) });
  assert.equal(seq.length, 225);
  for (let d = 1; d <= 9; d++) assert.equal(seq.filter((x) => x === d).length, 25);
});

test('balanced non-3 counts differ by at most 1 when they cannot divide evenly', () => {
  const seq = generateSequence(100, 0.2, { balanced: true, random: seededRandom(5) });
  assert.equal(seq.filter((x) => x === TARGET_DIGIT).length, 20);
  const counts = [...countsOf(seq).values()];
  assert.equal(counts.reduce((a, b) => a + b, 0), 80);
  assert.deepEqual(counts, Array(8).fill(10));
  const odd = [...countsOf(generateSequence(53, 0.2, { balanced: true, random: seededRandom(2) })).values()];
  assert.equal(odd.reduce((a, b) => a + b, 0), 42);
  assert.ok(Math.max(...odd) - Math.min(...odd) <= 1);
});

test('balancedCounts gives the extras to different digits on different draws', () => {
  const picks = new Set();
  for (let seed = 1; seed < 30; seed++) {
    const counts = balancedCounts(9, seededRandom(seed));
    picks.add([...counts].find(([, c]) => c === 2)[0]);
  }
  assert.ok(picks.size > 3);
});

test('balanced sequences are still shuffled', () => {
  const seq = generateSequence(225, 0.111, { balanced: true, random: seededRandom(4) });
  assert.notDeepEqual(seq.slice(0, 25), Array(25).fill(TARGET_DIGIT));
});

const pressAt = (digit, rtMs, mode) => scoreTrial(registerPress(createTrial(1, digit), rtMs, mode));

test('classic mode: a press during the digit or what follows is a normal response', () => {
  assert.equal(cueOffsetMs(250, 'classic'), 0);
  assert.equal(pressAt(5, 120, 'classic').outcome, 'hit');
  assert.equal(pressAt(5, 900, 'classic').outcome, 'hit');
  assert.equal(pressAt(3, 120, 'classic').outcome, 'commission');
});

test('wait_mask mode: RT is from the mask; a non-3 pressed before it is early', () => {
  assert.equal(cueOffsetMs(250, 'wait_mask'), 250);
  const early = pressAt(5, -100, 'wait_mask');
  assert.equal(early.outcome, 'early');
  assert.equal(early.rtMs, -100);
  assert.equal(pressAt(5, 0, 'wait_mask').outcome, 'hit');
  assert.equal(pressAt(5, 400, 'wait_mask').outcome, 'hit');
  assert.equal(pressAt(3, -100, 'wait_mask').outcome, 'commission');
  assert.equal(pressAt(3, 400, 'wait_mask').outcome, 'commission');
  assert.equal(scoreTrial(createTrial(1, 5)).outcome, 'omission');
  assert.equal(scoreTrial(createTrial(1, 3)).outcome, 'withhold');
});

test('wait_mask mode: the first press decides, a later press during the mask does not rescue it', () => {
  let trial = registerPress(createTrial(1, 5), -50, 'wait_mask');
  trial = registerPress(trial, 300, 'wait_mask');
  const scored = scoreTrial(trial);
  assert.equal(scored.outcome, 'early');
  assert.equal(scored.rtMs, -50);
  assert.equal(scored.extraPresses, 1);
});

test('early presses are not anticipations, and they count against accuracy and in the summary', () => {
  assert.equal(isAnticipation(pressAt(5, -50, 'wait_mask')), false);
  assert.equal(isAnticipation(pressAt(5, 50, 'wait_mask')), true);
  const s = summarize([pressAt(5, -50, 'wait_mask'), pressAt(5, 300, 'wait_mask'), scoreTrial(createTrial(1, 3))]);
  assert.equal(s.earlyCount, 1);
  assert.equal(s.correctHits, 1);
  assert.equal(s.omissionErrors, 0);
  assert.equal(s.accuracy, 67);
  assert.equal(s.omissionRate, 0);
  assert.equal(s.meanRtMs, 300);
  assert.equal(outcomeOf(false, true, true), 'early');
});

test('feedback for an early press is an error', () => {
  assert.equal(feedbackFor('early', 'errors'), 'early');
  assert.equal(feedbackFor('early', 'off'), null);
});

test('settingsProblem checks the mask and response mode', () => {
  const ok = { displayDurationMs: 250, totalTrials: 225, targetFrequency: 0.111 };
  assert.equal(settingsProblem({ ...ok, maskMs: 900, responseMode: 'classic' }), null);
  assert.equal(settingsProblem({ ...ok, maskMs: 900, responseMode: 'wait_mask' }), null);
  assert.match(settingsProblem({ ...ok, maskMs: 0, responseMode: 'wait_mask' }), /butuh mask/);
  assert.match(settingsProblem({ ...ok, maskMs: 800 }), /Mask harus/);
  assert.match(settingsProblem({ ...ok, responseMode: 'fast' }), /Mode respons/);
});

test('adminSettingsProblem checks the practice settings', () => {
  const ok = { displayDurationMs: 250, totalTrials: 225, targetFrequency: 0.111, maskMs: 900,
    responseMode: 'classic', practiceSessions: 3, practiceTrials: 18, trialMode: false };
  assert.equal(adminSettingsProblem(ok), null);
  assert.equal(adminSettingsProblem({ ...ok, practiceSessions: 0 }), null);
  for (const practiceSessions of [-1, 6, 1.5]) assert.match(adminSettingsProblem({ ...ok, practiceSessions }), /sesi latihan/);
  for (const practiceTrials of [9, 501, 18.5]) assert.match(adminSettingsProblem({ ...ok, practiceTrials }), /angka per sesi latihan/);
  assert.match(adminSettingsProblem({ ...ok, practiceTrials: 10, targetFrequency: 0.04 }), /tidak ada angka 3/);
  assert.match(adminSettingsProblem({ ...ok, trialMode: true, practiceSessions: 0 }), /minimal 1 sesi latihan/);
});

test('practiceChoices offers another practice until N, and the main session unless in the practice period', () => {
  assert.deepEqual(practiceChoices({ practiceDone: 1, practiceSessions: 3, trialMode: false }), { practiceAgain: true, startMain: true });
  assert.deepEqual(practiceChoices({ practiceDone: 3, practiceSessions: 3, trialMode: false }), { practiceAgain: false, startMain: true });
  assert.deepEqual(practiceChoices({ practiceDone: 2, practiceSessions: 3, trialMode: true }), { practiceAgain: true, startMain: false });
  assert.deepEqual(practiceChoices({ practiceDone: 3, practiceSessions: 3, trialMode: true }), { practiceAgain: false, startMain: false });
});
