// Validation of request bodies. Pure functions, so they can be unit-tested with node --test.

import {
  SETTING_OPTIONS, FEEDBACK_MODES, FONT_SIZES_PT, BLANK_MS, targetCount, createTrial, registerPress, scoreTrial,
} from '../public/js/sart.js';

export const INPUT_TYPES = ['keyboard', 'touch', 'mixed', 'none'];
// Timer callbacks can fire slightly after the window closes; allow some slack.
const RT_SLACK_MS = 100;

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
  const { displayDurationMs, totalTrials, targetFrequency } = body;
  if (!SETTING_OPTIONS.displayDurationMs.includes(displayDurationMs)) fail('invalid displayDurationMs');
  if (!SETTING_OPTIONS.totalTrials.includes(totalTrials)) fail('invalid totalTrials');
  if (!SETTING_OPTIONS.targetFrequency.includes(targetFrequency)) fail('invalid targetFrequency');
  if (typeof body.randomFontSize !== 'boolean') fail('randomFontSize must be a boolean');
  return { displayDurationMs, totalTrials, targetFrequency, randomFontSize: body.randomFontSize };
}

export function validateAdminSettings(body) {
  const settings = validateSettings(body);
  if (typeof body.trialMode !== 'boolean') fail('trialMode must be a boolean');
  if (!FEEDBACK_MODES.includes(body.feedbackMode)) fail('invalid feedbackMode');
  return { ...settings, trialMode: body.trialMode, feedbackMode: body.feedbackMode };
}

// Rebuilds every trial from its digit and presses, so the outcome is
// always computed by the engine and never taken from the browser.
function validateTrials(rawTrials, settings, status) {
  if (!Array.isArray(rawTrials)) fail('trials must be an array');
  const { displayDurationMs, totalTrials, targetFrequency } = settings;
  if (status === 'completed' && rawTrials.length !== totalTrials) fail('completed session must have every trial');
  if (rawTrials.length > totalTrials) fail('too many trials');

  const maxRt = displayDurationMs + BLANK_MS + RT_SLACK_MS;
  const trials = rawTrials.map((raw, i) => {
    if (!raw || typeof raw !== 'object') fail(`trial ${i + 1} must be an object`);
    if (raw.trialNo !== i + 1) fail(`trial ${i + 1} has the wrong trialNo`);
    if (!Number.isInteger(raw.digit) || raw.digit < 1 || raw.digit > 9) fail(`trial ${i + 1} has an invalid digit`);
    if (typeof raw.responded !== 'boolean') fail(`trial ${i + 1} responded must be a boolean`);
    nonNegativeInt(raw.extraPresses, `trial ${i + 1} extraPresses`);

    let trial = createTrial(raw.trialNo, raw.digit);
    if (raw.responded) {
      if (typeof raw.rtMs !== 'number' || !Number.isFinite(raw.rtMs) || raw.rtMs < 0 || raw.rtMs > maxRt) {
        fail(`trial ${i + 1} has an invalid rtMs`);
      }
      trial = registerPress(trial, raw.rtMs);
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
  return trials;
}

export function validateResult(body) {
  if (!body || typeof body !== 'object') fail('body must be an object');
  const participantName = text(body.participantName, 'participantName', 100);
  const participantIdRaw = text(body.participantId, 'participantId', 64);
  if (!['completed', 'aborted'].includes(body.status)) fail('status must be completed or aborted');
  if (typeof body.consentAt !== 'string' || Number.isNaN(Date.parse(body.consentAt))) fail('consentAt must be a date');

  const settings = validateSettings(body.settings);
  const device = body.device ?? {};
  if (!INPUT_TYPES.includes(device.inputType)) fail('invalid device.inputType');

  return {
    participantName,
    participantIdRaw,
    participantId: normaliseParticipantId(participantIdRaw),
    status: body.status,
    consentAt: new Date(body.consentAt).toISOString(),
    settings,
    screenWidth: optionalInt(device.screenWidth, 'device.screenWidth'),
    screenHeight: optionalInt(device.screenHeight, 'device.screenHeight'),
    inputType: device.inputType,
    tabHiddenCount: nonNegativeInt(body.tabHiddenCount, 'tabHiddenCount'),
    trials: validateTrials(body.trials, settings, body.status),
  };
}
