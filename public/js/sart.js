// SART engine: sequence generation, trial logic and scoring.
// Pure functions only, no DOM. Shared by the browser, the Worker and the tests.

export const TARGET_DIGIT = 3;
export const NON_TARGET_DIGITS = [1, 2, 4, 5, 6, 7, 8, 9];
export const BLANK_MS = 200;
// The 3-2-1 countdown before every session replaces a silent start delay (PLAN.md §9 D32).
export const COUNTDOWN_FROM = 3;
export const COUNTDOWN_STEP_MS = 1000;
export const COUNTDOWN_LABEL = 'Tes dimulai dalam...';
export const ANTICIPATION_MS = 100;
export const FEEDBACK_PAUSE_MS = 1000;
export const FEEDBACK_MODES = ['off', 'errors', 'all'];
// Robertson et al. (1997) font sizes in pt. On screen, 120 pt is the normal digit size
// and the others are scaled by size / 120 (PLAN.md §9 D26).
export const FONT_SIZES_PT = [48, 72, 94, 100, 120];

// 'classic': a press counts during the digit or what follows it. 'wait_mask': a non-3 must be
// answered while the mask shows; a press before it is 'early' (PLAN.md §9 D31).
export const RESPONSE_MODES = ['classic', 'wait_mask'];
// Free-text settings (PLAN.md §9 D27). 500 trials keeps a saved session well inside the
// request size limit; the proportion of 3s is a percentage with at most one decimal.
export const SETTING_LIMITS = {
  // Free numbers in ms (PLAN.md §9 D34). A mask of 0 means no mask: the digit is followed by the
  // 200 ms blank. Classic SART is a 250 ms digit and a 900 ms mask (D30).
  displayDurationMs: { min: 100, max: 2000 },
  maskMs: { min: 100, max: 2000 },
  totalTrials: { min: 10, max: 500 },
  targetPercent: { min: 1, max: 50 },
  practiceSessions: { min: 0, max: 5 },
};

// Why a combination of test settings is not allowed, in Indonesian for the admin page,
// or null when it is fine. Used by the admin form and by the server.
export function settingsProblem({
  displayDurationMs, totalTrials, targetFrequency, maskMs = 0, responseMode = 'classic',
}) {
  const { totalTrials: t, targetPercent: p, displayDurationMs: d, maskMs: m } = SETTING_LIMITS;
  if (!Number.isInteger(displayDurationMs) || displayDurationMs < d.min || displayDurationMs > d.max) {
    return `Durasi angka harus bilangan bulat dari ${d.min} sampai ${d.max} ms.`;
  }
  if (!Number.isInteger(maskMs) || (maskMs !== 0 && (maskMs < m.min || maskMs > m.max))) {
    return `Mask harus 0 (mati) atau bilangan bulat dari ${m.min} sampai ${m.max} ms.`;
  }
  if (!RESPONSE_MODES.includes(responseMode)) return 'Mode respons tidak dikenal.';
  if (responseMode === 'wait_mask' && maskMs === 0) {
    return 'Mode respons "Tunggu mask" butuh mask. Pilih durasi mask atau gunakan mode Klasik.';
  }
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

// The admin form's full check: the test settings, then the practice settings (PLAN.md §9 D33).
export function adminSettingsProblem(s) {
  const problem = settingsProblem(s);
  if (problem) return problem;
  const { practiceSessions: n, totalTrials: t } = SETTING_LIMITS;
  if (!Number.isInteger(s.practiceSessions) || s.practiceSessions < n.min || s.practiceSessions > n.max) {
    return `Jumlah sesi latihan harus bilangan bulat dari ${n.min} sampai ${n.max}.`;
  }
  if (!Number.isInteger(s.practiceTrials) || s.practiceTrials < t.min || s.practiceTrials > t.max) {
    return `Jumlah angka per sesi latihan harus bilangan bulat dari ${t.min} sampai ${t.max}.`;
  }
  if (targetCount(s.practiceTrials, s.targetFrequency) < 1) {
    return 'Dengan jumlah angka latihan dan proporsi ini tidak ada angka 3 yang muncul. Naikkan salah satunya.';
  }
  if (s.trialMode && s.practiceSessions === 0) {
    return 'Mode latihan butuh minimal 1 sesi latihan.';
  }
  return null;
}

// What the participant may do after a practice session (PLAN.md §9 D33). Practice 1 is
// required; after practice N only the main session is offered. While the study's practice
// period is on (trialMode), the main session is never offered.
export function practiceChoices({ practiceDone, practiceSessions, trialMode }) {
  return {
    practiceAgain: practiceDone < practiceSessions,
    startMain: !trialMode,
  };
}

export const DEFAULT_SETTINGS = {
  displayDurationMs: 500,
  totalTrials: 100,
  targetFrequency: 0.2,
  trialMode: false,
  feedbackMode: 'off',
  randomFontSize: false,
  balancedDigits: false,
  maskMs: 0,
  responseMode: 'classic',
  practiceSessions: 1,
  practiceTrials: 18,
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

// What follows the digit: the mask when there is one, otherwise the 200 ms blank.
export function afterDigitMs(maskMs = 0) {
  return maskMs > 0 ? maskMs : BLANK_MS;
}

// The response window is the digit display plus what follows it (PLAN.md §2, §9 D30).
export function responseWindowMs(displayDurationMs, maskMs = 0) {
  return displayDurationMs + afterDigitMs(maskMs);
}

// RT is measured from this point after digit onset: the digit itself in classic mode,
// the mask in 'wait_mask' mode (PLAN.md §9 D31).
export function cueOffsetMs(displayDurationMs, responseMode = 'classic') {
  return responseMode === 'wait_mask' ? displayDurationMs : 0;
}

export function createTrial(trialNo, digit) {
  return {
    trialNo,
    digit,
    isTarget: digit === TARGET_DIGIT,
    responded: false,
    rtMs: null,
    early: false,
    extraPresses: 0,
  };
}

// Only the first press in a window sets the RT; later ones are counted (PLAN.md §9 D1).
// rtMs is measured from the cue (see cueOffsetMs). In 'wait_mask' mode a press on a non-3
// before the mask has a negative RT and makes the trial 'early'; the first press decides.
export function registerPress(trial, rtMs, responseMode = 'classic') {
  if (trial.responded) return { ...trial, extraPresses: trial.extraPresses + 1 };
  const early = responseMode === 'wait_mask' && !trial.isTarget && rtMs < 0;
  return { ...trial, responded: true, rtMs, early };
}

export function outcomeOf(isTarget, responded, early = false) {
  if (isTarget) return responded ? 'commission' : 'withhold';
  if (early) return 'early';
  return responded ? 'hit' : 'omission';
}

// Called once, when the trial's response window closes.
export function scoreTrial(trial) {
  return { ...trial, outcome: outcomeOf(trial.isTarget, trial.responded, trial.early) };
}

// Feedback key for an outcome, or null when nothing is shown. Trial mode only (PLAN.md §9 D17).
// Errors keep their outcome ('commission' or 'omission') so the reason can be shown.
export function feedbackFor(outcome, mode) {
  const correct = outcome === 'hit' || outcome === 'withhold';
  if (correct) return mode === 'all' ? 'correct' : null;
  return mode === 'all' || mode === 'errors' ? outcome : null;
}

// Length of one session in ms: the countdown plus every trial's response window.
// feedbackPauses adds the 1 s pause after that many trials (practice feedback, PLAN.md §9 D18).
export function sessionDurationMs({ displayDurationMs, totalTrials, maskMs = 0 }, feedbackPauses = 0) {
  return COUNTDOWN_FROM * COUNTDOWN_STEP_MS
    + totalTrials * responseWindowMs(displayDurationMs, maskMs)
    + feedbackPauses * FEEDBACK_PAUSE_MS;
}

// Rounded up to whole minutes, countdown included. Feedback pauses are not included.
export function estimateMinutes(settings) {
  return Math.ceil(sessionDurationMs(settings) / 60000);
}

// Combines the input types of all presses in a session into one value.
export function combineInputTypes(types) {
  const set = new Set(types);
  if (set.size === 0) return 'none';
  if (set.size > 1) return 'mixed';
  return [...set][0];
}

// A press under 100 ms after the cue. Early presses (negative RT) are counted as 'early' instead.
export function isAnticipation(trial) {
  return trial.responded && trial.rtMs >= 0 && trial.rtMs < ANTICIPATION_MS;
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
  const earlyCount = count('early');
  const targets = commissionErrors + correctWithholds;
  const nonTargets = correctHits + omissionErrors + earlyCount;
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
    earlyCount,
  };
}
