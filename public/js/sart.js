// SART engine: sequence generation, trial logic and scoring.
// Pure functions only, no DOM. Shared by the browser, the Worker and the tests.

export const TARGET_DIGIT = 3;
export const NON_TARGET_DIGITS = [1, 2, 4, 5, 6, 7, 8, 9];
export const BLANK_MS = 200;
export const START_DELAY_MS = 1000;
export const ANTICIPATION_MS = 100;
export const FEEDBACK_PAUSE_MS = 1000;
export const FEEDBACK_MODES = ['off', 'errors', 'all'];
// Robertson et al. (1997) font sizes in pt. On screen, 120 pt is the normal digit size
// and the others are scaled by size / 120 (PLAN.md §9 D26).
export const FONT_SIZES_PT = [48, 72, 94, 100, 120];

export const DISPLAY_DURATIONS_MS = [250, 500, 750];
// Free-text settings (PLAN.md §9 D27). 500 trials keeps a saved session well inside the
// request size limit; the proportion of 3s is a percentage with at most one decimal.
export const SETTING_LIMITS = {
  totalTrials: { min: 10, max: 500 },
  targetPercent: { min: 1, max: 50 },
};

// Why a combination of test settings is not allowed, in Indonesian for the admin page,
// or null when it is fine. Used by the admin form and by the server.
export function settingsProblem({ displayDurationMs, totalTrials, targetFrequency }) {
  const { totalTrials: t, targetPercent: p } = SETTING_LIMITS;
  if (!DISPLAY_DURATIONS_MS.includes(displayDurationMs)) return 'Durasi angka harus 250, 500 atau 750 ms.';
  if (!Number.isInteger(totalTrials) || totalTrials < t.min || totalTrials > t.max) {
    return `Jumlah angka harus bilangan bulat dari ${t.min} sampai ${t.max}.`;
  }
  const tenths = targetFrequency * 1000;
  if (typeof targetFrequency !== 'number' || !Number.isFinite(targetFrequency)
    || Math.abs(tenths - Math.round(tenths)) > 1e-6
    || tenths < p.min * 10 - 1e-6 || tenths > p.max * 10 + 1e-6) {
    return `Proporsi angka 3 harus dari ${p.min}% sampai ${p.max}%, dengan paling banyak satu angka desimal.`;
  }
  if (targetCount(totalTrials, targetFrequency) < 1) {
    return 'Dengan jumlah angka dan proporsi ini tidak ada angka 3 yang muncul. Naikkan salah satunya.';
  }
  return null;
}

export const DEFAULT_SETTINGS = {
  displayDurationMs: 500,
  totalTrials: 100,
  targetFrequency: 0.2,
  trialMode: false,
  feedbackMode: 'off',
  randomFontSize: false,
  balancedDigits: false,
};

// Rounded to the nearest whole number, halves up, so 11.1% of 225 gives the classic
// SART's 25 targets (PLAN.md §9 D28). The reference rounds down; for its own nine
// setting combinations the product is always whole, so both rules agree there.
export function targetCount(totalTrials, targetFrequency) {
  // The epsilon guards against float products such as 0.29 * 100 = 28.999...
  return Math.floor(totalTrials * targetFrequency + 0.5 + 1e-9);
}

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// How many times each non-3 digit appears when digits are balanced (PLAN.md §9 D29):
// as equal as possible, so counts differ by at most 1. Extras go to random digits.
export function balancedCounts(nonTargetTrials, random = Math.random) {
  const base = Math.floor(nonTargetTrials / NON_TARGET_DIGITS.length);
  const extra = nonTargetTrials % NON_TARGET_DIGITS.length;
  const lucky = new Set(shuffle([...NON_TARGET_DIGITS], random).slice(0, extra));
  return new Map(NON_TARGET_DIGITS.map((d) => [d, base + (lucky.has(d) ? 1 : 0)]));
}

// Without balancing, each non-3 digit is drawn at random, as in the reference.
// With balancing, the non-3 digits appear equally often; the order is random either way.
export function generateSequence(totalTrials, targetFrequency, { balanced = false, random = Math.random } = {}) {
  const targets = targetCount(totalTrials, targetFrequency);
  const digits = Array(targets).fill(TARGET_DIGIT);
  if (balanced) {
    for (const [digit, count] of balancedCounts(totalTrials - targets, random)) {
      for (let i = 0; i < count; i++) digits.push(digit);
    }
  } else {
    for (let i = targets; i < totalTrials; i++) {
      digits.push(NON_TARGET_DIGITS[Math.floor(random() * NON_TARGET_DIGITS.length)]);
    }
  }
  return shuffle(digits, random);
}

// One font size per trial, each drawn with equal chance.
export function generateFontSizes(totalTrials, random = Math.random) {
  return Array.from({ length: totalTrials }, () => FONT_SIZES_PT[Math.floor(random() * FONT_SIZES_PT.length)]);
}

export function fontScale(fontSizePt) {
  return fontSizePt / FONT_SIZES_PT[FONT_SIZES_PT.length - 1];
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

// Feedback key for an outcome, or null when nothing is shown. Trial mode only (PLAN.md §9 D17).
// Errors keep their outcome ('commission' or 'omission') so the reason can be shown.
export function feedbackFor(outcome, mode) {
  const correct = outcome === 'hit' || outcome === 'withhold';
  if (correct) return mode === 'all' ? 'correct' : null;
  return mode === 'all' || mode === 'errors' ? outcome : null;
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
