import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TARGET_DIGIT, targetCount, generateSequence, responseWindowMs,
  createTrial, registerPress, scoreTrial, summarize,
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

test('targetCount floors trials x frequency for every allowed option', () => {
  assert.equal(targetCount(100, 0.2), 20);
  assert.equal(targetCount(50, 0.1), 5);
  assert.equal(targetCount(50, 0.3), 15);
  assert.equal(targetCount(200, 0.3), 60);
  assert.equal(targetCount(100, 0.29), 29);
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
