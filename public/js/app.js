// Participant app: screens, input and timing. All scoring lives in sart.js.

import {
  COUNTDOWN_FROM, COUNTDOWN_STEP_MS, FEEDBACK_PAUSE_MS, generateSequence, generateFontSizes, fontScale,
  responseWindowMs, cueOffsetMs, createTrial, registerPress, outcomeOf, scoreTrial, summarize, feedbackFor,
  estimateMinutes, combineInputTypes,
} from './sart.js';
import { API_BASE } from './config.js';

const FEEDBACK = {
  correct: { title: 'Benar', reason: '', kind: 'correct' },
  commission: { title: 'Salah', reason: 'Jangan tekan saat angka 3 muncul.', kind: 'wrong' },
  omission: { title: 'Salah', reason: 'Tekan untuk setiap angka selain 3.', kind: 'wrong' },
  early: { title: 'Salah', reason: 'Tunggu sampai simbol ⊗ muncul, lalu tekan.', kind: 'wrong' },
};
// In 'wait_mask' mode a miss means the participant did not press while the mask showed.
const OMISSION_REASON_WAIT_MASK = 'Tekan saat simbol ⊗ muncul setelah angka selain 3.';

const $ = (id) => document.getElementById(id);

// visitId links every session of one visit (PLAN.md §9 D33).
const participant = { name: '', id: '', consentAt: null, visitId: null };
let settings = null;
let run = null;
let pendingResult = null;

function show(screenId) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== screenId;
  window.scrollTo(0, 0);
}

// Identity form

function setFieldError(input, errorEl, message) {
  errorEl.hidden = !message;
  if (message) errorEl.textContent = message;
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

$('identity-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('name').value.trim();
  const id = $('participant-id').value.trim();
  const consent = $('consent').checked;
  setFieldError($('name'), $('name-error'), name ? '' : 'Nama wajib diisi.');
  setFieldError($('participant-id'), $('participant-id-error'), id ? '' : 'ID partisipan wajib diisi.');
  setFieldError($('consent'), $('consent-error'), consent ? '' : 'Centang persetujuan untuk melanjutkan.');

  const firstInvalid = [$('name'), $('participant-id'), $('consent')]
    .find((el) => el.getAttribute('aria-invalid') === 'true');
  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }
  Object.assign(participant, { name, id, consentAt: new Date().toISOString(), visitId: crypto.randomUUID() });
  openInstructions();
});

// Instructions

async function openInstructions() {
  show('screen-instructions');
  $('settings-loading').hidden = false;
  $('settings-error').hidden = true;
  $('instructions-body').hidden = true;
  try {
    const response = await fetch(`${API_BASE}/api/settings`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    settings = await response.json();
  } catch (err) {
    console.error(err);
    $('settings-loading').hidden = true;
    $('settings-error').hidden = false;
    $('settings-retry').focus();
    return;
  }

  const practice = settings.trialMode;
  const feedbackMode = practice ? settings.feedbackMode : 'off';
  $('practice-note').hidden = !practice;
  $('feedback-note').hidden = feedbackMode === 'off';
  $('feedback-note').textContent = feedbackMode === 'all'
    ? 'Setiap selesai satu angka, akan muncul tulisan "Benar" atau "Salah". Jika salah, alasannya ikut ditampilkan.'
    : 'Jika jawaban Anda keliru, akan muncul tulisan "Salah" beserta alasannya.';
  const waitMask = settings.responseMode === 'wait_mask';
  $('step-press').hidden = waitMask;
  $('step-press-wait').hidden = !waitMask;
  $('mask-note').hidden = settings.maskMs === 0 || waitMask;
  $('duration-note').textContent = `Tes berlangsung sekitar ${estimateMinutes(settings)} menit.`;
  $('settings-loading').hidden = true;
  $('instructions-body').hidden = false;
  $('instructions-title').focus();
}

$('instructions-title').tabIndex = -1;
$('settings-retry').addEventListener('click', openInstructions);
$('start-test').addEventListener('click', startTest);

// Test runner

function setStimulus(text, scale = 1) {
  $('stimulus').textContent = text;
  $('stimulus').className = 'stimulus';
  $('stimulus').style.setProperty('--digit-scale', scale);
  $('stimulus-reason').textContent = '';
  $('mask').hidden = true;
}

// The mask (circle with a diagonal cross) replaces the digit (PLAN.md §9 D30).
function showMask() {
  setStimulus('');
  $('mask').hidden = false;
}

function showFeedback(key) {
  const { title, kind } = FEEDBACK[key];
  const reason = key === 'omission' && run.settings.responseMode === 'wait_mask'
    ? OMISSION_REASON_WAIT_MASK
    : FEEDBACK[key].reason;
  setStimulus(title);
  $('stimulus').className = `stimulus feedback feedback-${kind}`;
  $('stimulus-reason').textContent = reason;
}

// 3, 2, 1 before the first digit, and again when the test resumes (PLAN.md §9 D32).
function countdown(then) {
  for (let i = 0; i < COUNTDOWN_FROM; i++) {
    later(i * COUNTDOWN_STEP_MS, () => setStimulus(String(COUNTDOWN_FROM - i)));
  }
  later(COUNTDOWN_FROM * COUNTDOWN_STEP_MS, () => {
    setStimulus('');
    then();
  });
}

function clearTimers() {
  for (const t of run.timers) clearTimeout(t);
  run.timers = [];
}

function later(ms, fn) {
  run.timers.push(setTimeout(fn, ms));
}

function startTest() {
  const practice = settings.trialMode;
  run = {
    settings: { ...settings },
    feedbackMode: practice ? settings.feedbackMode : 'off',
    sequence: generateSequence(settings.totalTrials, settings.targetFrequency, { balanced: settings.balancedDigits }),
    // Drawn up front so a replayed trial (PLAN.md §9 D19) keeps its size.
    fontSizes: settings.randomFontSize ? generateFontSizes(settings.totalTrials) : null,
    trials: [],
    index: 0,
    current: null,
    onset: 0,
    accepting: false,
    inputTypes: [],
    tabHiddenCount: 0,
    timers: [],
    paused: false,
  };
  $('test-practice-tag').hidden = !practice;
  setStimulus('');
  show('screen-test');
  $('test-area').focus();
  countdown(beginTrial);
}

function beginTrial() {
  if (run.index >= run.sequence.length) {
    finishTest('completed');
    return;
  }
  run.current = createTrial(run.index + 1, run.sequence[run.index]);
  const fontSizePt = run.fontSizes ? run.fontSizes[run.index] : null;
  run.current.fontSizePt = fontSizePt;
  setStimulus(String(run.current.digit), fontSizePt ? fontScale(fontSizePt) : 1);
  run.onset = performance.now();
  run.accepting = true;
  const { displayDurationMs, maskMs } = run.settings;
  later(displayDurationMs, () => {
    // Keep feedback that was shown at the press; otherwise mask or blank the digit.
    if ($('stimulus').classList.contains('feedback')) return;
    if (maskMs > 0) showMask();
    else setStimulus('');
  });
  later(responseWindowMs(displayDurationMs, maskMs), endWindow);
}

function onPress(inputType) {
  if (!run || run.paused || !run.accepting) return;
  // RT from the cue: the digit in classic mode, the mask in 'wait_mask' mode (PLAN.md §9 D31).
  const { displayDurationMs, responseMode } = run.settings;
  const rtMs = performance.now() - run.onset - cueOffsetMs(displayDurationMs, responseMode);
  const isFirst = !run.current.responded;
  run.current = registerPress(run.current, rtMs, responseMode);
  run.inputTypes.push(inputType);
  if (isFirst) {
    const feedback = feedbackFor(outcomeOf(run.current.isTarget, true, run.current.early), run.feedbackMode);
    if (feedback) showFeedback(feedback);
  }
}

function endWindow() {
  run.accepting = false;
  const trial = scoreTrial(run.current);
  run.trials.push(trial);
  run.current = null;
  run.index += 1;
  const feedback = feedbackFor(trial.outcome, run.feedbackMode);
  if (!feedback) {
    beginTrial();
    return;
  }
  showFeedback(feedback);
  later(FEEDBACK_PAUSE_MS, () => {
    setStimulus('');
    beginTrial();
  });
}

// While the test runs, Space is captured on keydown and keyup so it never activates a
// focused button. While paused it is left alone so the dialog buttons work with Space.
const capturingSpace = (event) => run && !run.paused && !$('screen-test').hidden && event.code === 'Space';

document.addEventListener('keydown', (event) => {
  if (!capturingSpace(event)) return;
  event.preventDefault();
  if (event.repeat) return;
  onPress('keyboard');
});
document.addEventListener('keyup', (event) => {
  if (capturingSpace(event)) event.preventDefault();
});

// Mouse clicks are not responses; the instructions ask for the spacebar on a computer.
$('test-area').addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse') return;
  event.preventDefault();
  onPress('touch');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && run && !$('screen-test').hidden) run.tabHiddenCount += 1;
});

// End early (PLAN.md §9 D5): pause, discard the trial in progress, replay it on cancel.

$('end-test').addEventListener('click', () => {
  run.paused = true;
  run.accepting = false;
  clearTimers();
  run.current = null;
  setStimulus('');
  $('end-dialog').showModal();
});

function resumeTest() {
  $('end-dialog').close();
  run.paused = false;
  $('test-area').focus();
  countdown(beginTrial);
}

$('end-cancel').addEventListener('click', resumeTest);
$('end-dialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  resumeTest();
});
$('end-confirm').addEventListener('click', () => {
  $('end-dialog').close();
  finishTest('aborted');
});

// Saving and results

function finishTest(status) {
  clearTimers();
  pendingResult = {
    status,
    practice: run.settings.trialMode,
    body: {
      participantName: participant.name,
      participantId: participant.id,
      status,
      // Until the practice flow is in place, the study-wide practice switch decides the kind.
      sessionKind: run.settings.trialMode ? 'practice' : 'main',
      practiceNo: run.settings.trialMode ? 1 : null,
      visitId: participant.visitId,
      consentAt: participant.consentAt,
      settings: {
        displayDurationMs: run.settings.displayDurationMs,
        totalTrials: run.settings.totalTrials,
        targetFrequency: run.settings.targetFrequency,
        randomFontSize: run.settings.randomFontSize,
        balancedDigits: run.settings.balancedDigits,
        maskMs: run.settings.maskMs,
        responseMode: run.settings.responseMode,
      },
      device: {
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        inputType: combineInputTypes(run.inputTypes),
      },
      tabHiddenCount: run.tabHiddenCount,
      trials: run.trials.map(({ trialNo, digit, responded, rtMs, extraPresses, fontSizePt }) => ({
        trialNo, digit, responded, rtMs, extraPresses, fontSizePt,
      })),
    },
    summary: summarize(run.trials),
  };
  run = null;
  saveResult();
}

async function saveResult() {
  show('screen-saving');
  $('saving-status').hidden = false;
  $('saving-error').hidden = true;
  try {
    const response = await fetch(`${API_BASE}/api/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingResult.body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  } catch (err) {
    console.error(err);
    $('saving-status').hidden = true;
    $('saving-error').hidden = false;
    $('saving-retry').focus();
    return;
  }

  const result = pendingResult;
  pendingResult = null;
  if (result.status === 'aborted') {
    returnToForm();
    return;
  }
  showResults(result);
}

$('saving-retry').addEventListener('click', saveResult);

function showResults({ practice, summary }) {
  $('results-title').textContent = practice ? 'Hasil latihan' : 'Hasil Anda';
  $('result-accuracy').textContent = `${summary.accuracy}%`;
  $('result-hits').textContent = summary.correctHits;
  $('result-commissions').textContent = summary.commissionErrors;
  $('result-omissions').textContent = summary.omissionErrors;
  show('screen-results');
  $('results-title').focus();
}

$('results-title').tabIndex = -1;
$('retry').addEventListener('click', openInstructions);

// After an early end the participant is back at the form; consent must be given again.
function returnToForm() {
  $('consent').checked = false;
  participant.consentAt = null;
  show('screen-form');
  $('form-title').focus();
}

$('form-title').tabIndex = -1;

// Warn before leaving while a test is running or a result is unsaved.
window.addEventListener('beforeunload', (event) => {
  if (run || pendingResult) event.preventDefault();
});
