// SART engine: sequence generation, trial logic and scoring.
// Pure functions only, no DOM. Shared by the browser, the Worker and the tests.

export const TARGET_DIGIT = 3;
export const NON_TARGET_DIGITS = [1, 2, 4, 5, 6, 7, 8, 9];
export const BLANK_MS = 200;
export const START_DELAY_MS = 1000;
export const ANTICIPATION_MS = 100;
export const FEEDBACK_PAUSE_MS = 500;
export const FEEDBACK_MODES = ['off', 'errors', 'all'];

export const SETTING_OPTIONS = {
  displayDurationMs: [250, 500, 750],
  totalTrials: [50, 100, 200],
  targetFrequency: [0.1, 0.2, 0.3],
};

export const DEFAULT_SETTINGS = {
  displayDurationMs: 500,
  totalTrials: 100,
  targetFrequency: 0.2,
  trialMode: false,
  feedbackMode: 'off',
};

export function targetCount(totalTrials, targetFrequency) {
  // The epsilon guards against float products such as 0.29 * 100 = 28.999...
  return Math.floor(totalTrials * targetFrequency + 1e-9);
}

export function generateSequence(totalTrials, targetFrequency, random = Math.random) {
  const targets = targetCount(totalTrials, targetFrequency);
  const digits = [];
  for (let i = 0; i < totalTrials; i++) {
    digits.push(i < targets
      ? TARGET_DIGIT
      : NON_TARGET_DIGITS[Math.floor(random() * NON_TARGET_DIGITS.length)]);
  }
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits;
}

// The response window is the digit display plus the blank after it (PLAN.md §2).
export function responseWindowMs(displayDurationMs) {
  return displayDurationMs + BLANK_MS;
}

export function createTrial(trialNo, digit) {
  return {
    trialNo,
    digit,
    isTarget: digit === TARGET_DIGIT,
    responded: false,
    rtMs: null,
    extraPresses: 0,
  };
}

// Only the first press in a window sets the RT; later ones are counted (PLAN.md §9 D1).
export function registerPress(trial, rtMs) {
  if (trial.responded) return { ...trial, extraPresses: trial.extraPresses + 1 };
  return { ...trial, responded: true, rtMs };
}

export function outcomeOf(isTarget, responded) {
  if (isTarget) return responded ? 'commission' : 'withhold';
  return responded ? 'hit' : 'omission';
}

// Called once, when the trial's response window closes.
export function scoreTrial(trial) {
  return { ...trial, outcome: outcomeOf(trial.isTarget, trial.responded) };
}

// Feedback text key for an outcome, or null when nothing is shown. Trial mode only (PLAN.md §9 D17).
export function feedbackFor(outcome, mode) {
  const correct = outcome === 'hit' || outcome === 'withhold';
  if (mode === 'all') return correct ? 'correct' : 'wrong';
  if (mode === 'errors') return correct ? null : 'wrong';
  return null;
}

// Rounded up to whole minutes. Feedback pauses are not included.
export function estimateMinutes({ displayDurationMs, totalTrials }) {
  return Math.ceil((START_DELAY_MS + totalTrials * responseWindowMs(displayDurationMs)) / 60000);
}

// Combines the input types of all presses in a session into one value.
export function combineInputTypes(types) {
  const set = new Set(types);
  if (set.size === 0) return 'none';
  if (set.size > 1) return 'mixed';
  return [...set][0];
}

export function isAnticipation(trial) {
  return trial.responded && trial.rtMs < ANTICIPATION_MS;
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Sample SD (n - 1), matching R, SPSS and pandas defaults.
function sampleSd(values) {
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

// Summary over scored trials. Metrics with an empty denominator are null.
export function summarize(trials) {
  const count = (outcome) => trials.filter((t) => t.outcome === outcome).length;
  const correctHits = count('hit');
  const commissionErrors = count('commission');
  const omissionErrors = count('omission');
  const correctWithholds = count('withhold');
  const targets = commissionErrors + correctWithholds;
  const nonTargets = correctHits + omissionErrors;
  const n = trials.length;

  const hitRts = trials
    .filter((t) => t.outcome === 'hit' && !isAnticipation(t))
    .map((t) => t.rtMs);
  const meanRtMs = hitRts.length > 0 ? mean(hitRts) : null;
  const sdRtMs = hitRts.length > 1 ? sampleSd(hitRts) : null;

  return {
    trialsCompleted: n,
    correctHits,
    commissionErrors,
    omissionErrors,
    correctWithholds,
    accuracy: n > 0 ? Math.round(((correctHits + correctWithholds) / n) * 100) : null,
    meanRtMs,
    sdRtMs,
    rtCv: sdRtMs !== null && meanRtMs > 0 ? sdRtMs / meanRtMs : null,
    commissionRate: targets > 0 ? commissionErrors / targets : null,
    omissionRate: nonTargets > 0 ? omissionErrors / nonTargets : null,
    anticipationCount: trials.filter(isAnticipation).length,
  };
}
