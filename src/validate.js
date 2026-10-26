// Validation of request bodies. Pure functions, so they can be unit-tested with node --test.

import {
  settingsProblem, adminSettingsProblem, afterDigitMs, SETTING_LIMITS, FEEDBACK_MODES,
  NON_TARGET_DIGITS, FONT_SIZES_PT, targetCount, createTrial, registerPress, scoreTrial,
} from '../public/js/sart.js';

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
  return {
    displayDurationMs, totalTrials, targetFrequency, maskMs, responseMode,
    randomFontSize: body.randomFontSize, balancedDigits: body.balancedDigits,
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
    return { ...scoreTrial(trial), fontSizePt };
  });

  const targets = trials.filter((t) => t.isTarget).length;
  const expected = targetCount(totalTrials, targetFrequency);
  if (status === 'completed' ? targets !== expected : targets > expected) fail('wrong number of target digits');

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
  const device = body.device ?? {};
  if (!INPUT_TYPES.includes(device.inputType)) fail('invalid device.inputType');

  return {
    participantName,
    participantIdRaw,
    participantId: normaliseParticipantId(participantIdRaw),
    status: body.status,
    sessionKind: body.sessionKind,
    practiceNo,
    visitId: body.visitId.toLowerCase(),
    consentAt: new Date(body.consentAt).toISOString(),
    settings,
    screenWidth: optionalInt(device.screenWidth, 'device.screenWidth'),
    screenHeight: optionalInt(device.screenHeight, 'device.screenHeight'),
    inputType: device.inputType,
    tabHiddenCount: nonNegativeInt(body.tabHiddenCount, 'tabHiddenCount'),
    trials: validateTrials(body.trials, settings, body.status),
  };
}
