// Validation of request bodies. Pure functions, so they can be unit-tested with node --test.

import {
  settingsProblem, adminSettingsProblem, setMetaProblem, normaliseSetCode, afterDigitMs, SETTING_LIMITS, FEEDBACK_MODES,
  NON_TARGET_DIGITS, FONT_SIZES_PT, FONT_COLORS, targetCount, createTrial, registerPress, scoreTrial,
} from '../public/js/sart.js';

// A session cannot honestly last longer than this; it only catches nonsense values.
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

export const INPUT_TYPES = ['keyboard', 'touch', 'mixed', 'none'];
// Timer callbacks can fire slightly after the window closes; allow some slack.
const RT_SLACK_MS = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {}

function fail(message) {
  throw new ValidationError(message);
}

function text(value, field, maxLength) {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) fail(`${field} is required`);
  if (trimmed.length > maxLength) fail(`${field} is longer than ${maxLength} characters`);
  return trimmed;
}

function nonNegativeInt(value, field) {
  if (!Number.isInteger(value) || value < 0) fail(`${field} must be a non-negative integer`);
  return value;
}

function optionalInt(value, field) {
  return value === null || value === undefined ? null : nonNegativeInt(value, field);
}

export function normaliseParticipantId(raw) {
  return raw.trim().toLowerCase();
}

export function validateSettings(body) {
  if (!body || typeof body !== 'object') fail('settings must be an object');
  const { displayDurationMs, totalTrials, targetFrequency, maskMs, responseMode } = body;
  const problem = settingsProblem({ displayDurationMs, totalTrials, targetFrequency, maskMs, responseMode });
  if (problem) fail(problem);
  if (maskMs === undefined || responseMode === undefined) fail('maskMs and responseMode are required');
  if (typeof body.randomFontSize !== 'boolean') fail('randomFontSize must be a boolean');
  if (typeof body.balancedDigits !== 'boolean') fail('balancedDigits must be a boolean');
  // Missing means off, so a page loaded before this setting existed can still save its result.
  const randomFontColor = body.randomFontColor ?? false;
  if (typeof randomFontColor !== 'boolean') fail('randomFontColor must be a boolean');
  return {
    displayDurationMs, totalTrials, targetFrequency, maskMs, responseMode,
    randomFontSize: body.randomFontSize, randomFontColor, balancedDigits: body.balancedDigits,
  };
}

export function validateAdminSettings(body) {
  const settings = validateSettings(body);
  if (typeof body.trialMode !== 'boolean') fail('trialMode must be a boolean');
  if (!FEEDBACK_MODES.includes(body.feedbackMode)) fail('invalid feedbackMode');
  const all = {
    ...settings,
    trialMode: body.trialMode,
    feedbackMode: body.feedbackMode,
    practiceSessions: body.practiceSessions,
    practiceTrials: body.practiceTrials,
  };
  const problem = adminSettingsProblem(all);
  if (problem) fail(problem);
  return all;
}

// A test set from the admin page: its code, label and active switch, then its settings (PLAN.md §9 D38).
export function validateSet(body) {
  if (!body || typeof body !== 'object') fail('set must be an object');
  const problem = setMetaProblem(body);
  if (problem) fail(problem);
  if (typeof body.isActive !== 'boolean') fail('isActive must be a boolean');
  return {
    code: normaliseSetCode(body.code),
    label: body.label.trim(),
    isActive: body.isActive,
    ...validateAdminSettings(body),
  };
}

// Rebuilds every trial from its digit and presses, so the outcome is
// always computed by the engine and never taken from the browser.
function validateTrials(rawTrials, settings, status) {
  if (!Array.isArray(rawTrials)) fail('trials must be an array');
  const { displayDurationMs, totalTrials, targetFrequency, maskMs, responseMode } = settings;
  if (status === 'completed' && rawTrials.length !== totalTrials) fail('completed session must have every trial');
  if (rawTrials.length > totalTrials) fail('too many trials');

  // RT is measured from the cue: digit onset in classic mode, mask onset in 'wait_mask' mode,
  // where a press during the digit has a negative RT (PLAN.md §9 D31).
  const waitMask = responseMode === 'wait_mask';
  const minRt = waitMask ? -displayDurationMs : 0;
  const maxRt = (waitMask ? 0 : displayDurationMs) + afterDigitMs(maskMs) + RT_SLACK_MS;
  const trials = rawTrials.map((raw, i) => {
    if (!raw || typeof raw !== 'object') fail(`trial ${i + 1} must be an object`);
    if (raw.trialNo !== i + 1) fail(`trial ${i + 1} has the wrong trialNo`);
    if (!Number.isInteger(raw.digit) || raw.digit < 1 || raw.digit > 9) fail(`trial ${i + 1} has an invalid digit`);
    if (typeof raw.responded !== 'boolean') fail(`trial ${i + 1} responded must be a boolean`);
    nonNegativeInt(raw.extraPresses, `trial ${i + 1} extraPresses`);

    let trial = createTrial(raw.trialNo, raw.digit);
    if (raw.responded) {
      if (typeof raw.rtMs !== 'number' || !Number.isFinite(raw.rtMs) || raw.rtMs < minRt || raw.rtMs > maxRt) {
        fail(`trial ${i + 1} has an invalid rtMs`);
      }
      trial = registerPress(trial, raw.rtMs, responseMode);
      trial = { ...trial, extraPresses: raw.extraPresses };
    } else if (raw.rtMs !== null || raw.extraPresses !== 0) {
      fail(`trial ${i + 1} has presses but responded is false`);
    }
    const fontSizePt = raw.fontSizePt ?? null;
    if (settings.randomFontSize ? !FONT_SIZES_PT.includes(fontSizePt) : fontSizePt !== null) {
      fail(`trial ${i + 1} has an invalid fontSizePt`);
    }
    const fontColor = raw.fontColor ?? null;
    if (settings.randomFontColor ? !FONT_COLORS.includes(fontColor) : fontColor !== null) {
      fail(`trial ${i + 1} has an invalid fontColor`);
    }
    return { ...scoreTrial(trial), fontSizePt, fontColor };
  });

  const targets = trials.filter((t) => t.isTarget).length;
  const expected = targetCount(totalTrials, targetFrequency);
  if (status === 'completed' ? targets !== expected : targets > expected) fail('wrong number of target digits');

  // Balanced colors: no color may appear more often than its share allows, and a completed
  // session must have them all within 1 of each other (PLAN.md §9 D37).
  if (settings.randomFontColor) {
    const counts = FONT_COLORS.map((c) => trials.filter((t) => t.fontColor === c).length);
    if (Math.max(...counts) > Math.ceil(totalTrials / FONT_COLORS.length)) fail('colors are not balanced');
    if (status === 'completed' && Math.max(...counts) - Math.min(...counts) > 1) fail('colors are not balanced');
  }

  // Balanced sessions: no non-3 digit may appear more often than its share allows,
  // and a completed session must have them all within 1 of each other (PLAN.md §9 D29).
  if (settings.balancedDigits) {
    const share = Math.ceil((totalTrials - expected) / NON_TARGET_DIGITS.length);
    const counts = NON_TARGET_DIGITS.map((d) => trials.filter((t) => t.digit === d).length);
    if (Math.max(...counts) > share) fail('digits are not balanced');
    if (status === 'completed' && Math.max(...counts) - Math.min(...counts) > 1) fail('digits are not balanced');
  }
  return trials;
}

export function validateResult(body) {
  if (!body || typeof body !== 'object') fail('body must be an object');
  const participantName = text(body.participantName, 'participantName', 100);
  const participantIdRaw = text(body.participantId, 'participantId', 64);
  if (!['completed', 'aborted'].includes(body.status)) fail('status must be completed or aborted');
  if (typeof body.consentAt !== 'string' || Number.isNaN(Date.parse(body.consentAt))) fail('consentAt must be a date');

  const setCode = normaliseSetCode(body.setCode);
  if (setMetaProblem({ code: setCode, label: '-' })) fail('invalid setCode');
  const settings = validateSettings(body.settings);
  // Practice or main session within one visit (PLAN.md §9 D33).
  if (!['practice', 'main'].includes(body.sessionKind)) fail('sessionKind must be practice or main');
  const practiceNo = body.sessionKind === 'practice' ? body.practiceNo : null;
  if (body.sessionKind === 'practice'
    && (!Number.isInteger(practiceNo) || practiceNo < 1 || practiceNo > SETTING_LIMITS.practiceSessions.max)) {
    fail('invalid practiceNo');
  }
  if (body.sessionKind === 'main' && body.practiceNo != null) fail('a main session has no practiceNo');
  if (typeof body.visitId !== 'string' || !UUID.test(body.visitId)) fail('visitId must be a UUID');
  // Optional, so a page loaded before this field existed can still save its result.
  let startedAt = null;
  let durationMs = null;
  if (body.startedAt != null || body.durationMs != null) {
    if (typeof body.startedAt !== 'string' || Number.isNaN(Date.parse(body.startedAt))) fail('startedAt must be a date');
    durationMs = nonNegativeInt(body.durationMs, 'durationMs');
    if (durationMs > MAX_DURATION_MS) fail('durationMs is too long');
    startedAt = new Date(body.startedAt).toISOString();
  }
  const device = body.device ?? {};
  if (!INPUT_TYPES.includes(device.inputType)) fail('invalid device.inputType');

  return {
    participantName,
    participantIdRaw,
    participantId: normaliseParticipantId(participantIdRaw),
    setCode,
    status: body.status,
    sessionKind: body.sessionKind,
    practiceNo,
    visitId: body.visitId.toLowerCase(),
    consentAt: new Date(body.consentAt).toISOString(),
    startedAt,
    durationMs,
    settings,
    screenWidth: optionalInt(device.screenWidth, 'device.screenWidth'),
    screenHeight: optionalInt(device.screenHeight, 'device.screenHeight'),
    inputType: device.inputType,
    tabHiddenCount: nonNegativeInt(body.tabHiddenCount, 'tabHiddenCount'),
    trials: validateTrials(body.trials, settings, body.status),
  };
}
