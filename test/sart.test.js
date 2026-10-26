import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TARGET_DIGIT, targetCount, generateSequence, responseWindowMs,
  createTrial, registerPress, scoreTrial, summarize,
  feedbackFor, estimateMinutes, combineInputTypes, settingsProblem, FONT_SIZES_PT, generateFontSizes, fontScale,
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
    const seq = generateSequence(n, f, seededRandom(n));
    assert.equal(seq.length, n);
    assert.equal(seq.filter((d) => d === TARGET_DIGIT).length, targetCount(n, f));
    assert.ok(seq.every((d) => Number.isInteger(d) && d >= 1 && d <= 9));
  }
});

test('generateSequence shuffles the targets', () => {
  const seq = generateSequence(100, 0.2, seededRandom(7));
  assert.notDeepEqual(seq.slice(0, 20), Array(20).fill(TARGET_DIGIT));
});

test('response window is display plus 200 ms blank', () => {
  assert.equal(responseWindowMs(250), 450);
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

test('estimateMinutes rounds the test length up', () => {
  assert.equal(estimateMinutes({ displayDurationMs: 500, totalTrials: 100 }), 2);
  assert.equal(estimateMinutes({ displayDurationMs: 250, totalTrials: 50 }), 1);
  assert.equal(estimateMinutes({ displayDurationMs: 750, totalTrials: 200 }), 4);
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
