// Participant app: screens, input and timing. All scoring lives in sart.js.

import {
  COUNTDOWN_FROM, COUNTDOWN_STEP_MS, COUNTDOWN_LABEL, FEEDBACK_PAUSE_MS, generateSequence, generateFontSizes, generateFontColors, fontScale,
  responseWindowMs, cueOffsetMs, createTrial, registerPress, outcomeOf, scoreTrial, summarize, feedbackFor,
  estimateMinutes, combineInputTypes, practiceChoices, normaliseSetCode,
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

// visitId links every session of one visit (PLAN.md §9 D33). setCode is the test set (D38).
const participant = { name: '', id: '', consentAt: null, visitId: null, setCode: null };
// The set named in the link (/?set=b), or null on the plain link, where the form asks for it.
const linkSetCode = normaliseSetCode(new URLSearchParams(window.location.search).get('set') ?? '') || null;
let settings = null;
let run = null;
let pendingResult = null;
// Practice sessions done in this visit, completed or ended early (PLAN.md §9 D33).
let practiceDone = 0;

function show(screenId) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== screenId;
  window.scrollTo(0, 0);
}

// Test set (PLAN.md §9 D38)

function setsProblem(message, canRetry) {
  $('sets-status').hidden = true;
  $('sets-error-text').textContent = message;
  $('sets-retry').hidden = !canRetry;
  $('sets-error').hidden = false;
  if (canRetry) $('sets-retry').focus();
}

// Only active sets are listed. A link to an unknown or inactive set does not fall back to
// another set, so a wrong link is noticed.
async function loadSets() {
  $('sets-status').hidden = false;
  $('sets-error').hidden = true;
  $('identity-form').hidden = true;
  let sets;
  try {
    const response = await fetch(`${API_BASE}/api/sets`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    sets = await response.json();
  } catch (err) {
    console.error(err);
    setsProblem('Tes belum bisa dimuat. Periksa koneksi internet Anda, lalu coba lagi.', true);
    return;
  }

  if (linkSetCode) {
    const set = sets.find((s) => s.code === linkSetCode);
    if (!set) {
      setsProblem('Tautan tidak valid. Minta tautan ke peneliti.', false);
      return;
    }
    $('set-tag').textContent = set.label;
    $('set-tag').hidden = false;
  } else {
    if (sets.length === 0) {
      setsProblem('Tes belum dibuka. Hubungi peneliti.', false);
      return;
    }
    // Nothing is pre-selected, so a set is always chosen on purpose.
    const placeholder = $('set-select').options[0];
    $('set-select').replaceChildren(placeholder, ...sets.map((s) => new Option(s.label, s.code)));
    $('set-field').hidden = false;
  }
  $('sets-status').hidden = true;
  $('identity-form').hidden = false;
}

$('sets-retry').addEventListener('click', loadSets);

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
  const setCode = linkSetCode ?? $('set-select').value;
  if (!linkSetCode) setFieldError($('set-select'), $('set-error'), setCode ? '' : 'Pilih set yang diminta peneliti.');
  setFieldError($('name'), $('name-error'), name ? '' : 'Nama wajib diisi.');
  setFieldError($('participant-id'), $('participant-id-error'), id ? '' : 'ID partisipan wajib diisi.');
  setFieldError($('consent'), $('consent-error'), consent ? '' : 'Centang persetujuan untuk melanjutkan.');

  const firstInvalid = [$('set-select'), $('name'), $('participant-id'), $('consent')]
    .find((el) => el.getAttribute('aria-invalid') === 'true');
  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }
  Object.assign(participant, { name, id, setCode, consentAt: new Date().toISOString(), visitId: crypto.randomUUID() });
  // A reload stays in the chosen set.
  if (!linkSetCode) {
    const url = new URL(window.location.href);
    url.searchParams.set('set', setCode);
    window.history.replaceState(null, '', url);
  }
  practiceDone = 0;
  openInstructions();
});

// Instructions

async function openInstructions() {
  show('screen-instructions');
  $('settings-loading').hidden = false;
  $('settings-error').hidden = true;
  $('instructions-body').hidden = true;
  let notFound = false;
  try {
    const response = await fetch(`${API_BASE}/api/settings?set=${encodeURIComponent(participant.setCode)}`, { cache: 'no-store' });
    // 404: the set was deactivated or deleted after the form was opened.
    notFound = response.status === 404;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    settings = await response.json();
  } catch (err) {
    console.error(err);
    $('settings-loading').hidden = true;
    $('settings-error-text').textContent = notFound
      ? 'Set ini sudah tidak aktif. Hubungi peneliti.'
      : 'Tes belum bisa dimuat. Periksa koneksi internet Anda, lalu coba lagi.';
    $('settings-retry').hidden = notFound;
    $('settings-error').hidden = false;
    if (!notFound) $('settings-retry').focus();
    return;
  }

  $('instructions-set').textContent = settings.label;
  $('instructions-set').hidden = false;

  const hasPractice = settings.practiceSessions > 0;
  const mainOffered = !settings.trialMode;
  const feedbackMode = hasPractice ? settings.feedbackMode : 'off';
  $('practice-note').hidden = !hasPractice;
  $('practice-note').textContent = mainOffered
    ? 'Anda mulai dengan sesi latihan. Setelah latihan, Anda bisa memilih latihan lagi atau mulai sesi utama.'
    : 'Saat ini hanya tersedia sesi latihan.';
  $('feedback-note').hidden = feedbackMode === 'off';
  $('feedback-note').textContent = feedbackMode === 'all'
    ? 'Saat latihan, setiap selesai satu angka akan muncul tulisan "Benar" atau "Salah". Jika salah, alasannya ikut ditampilkan.'
    : 'Saat latihan, jika jawaban Anda keliru akan muncul tulisan "Salah" beserta alasannya.';
  const waitMask = settings.responseMode === 'wait_mask';
  $('step-press').hidden = waitMask;
  $('step-press-wait').hidden = !waitMask;
  $('mask-note').hidden = settings.maskMs === 0 || waitMask;
  const practiceMinutes = estimateMinutes({ ...settings, totalTrials: settings.practiceTrials });
  const mainMinutes = estimateMinutes(settings);
  $('duration-note').textContent = [
    hasPractice ? `Satu sesi latihan sekitar ${practiceMinutes} menit.` : '',
    mainOffered ? `Sesi utama sekitar ${mainMinutes} menit.` : '',
  ].filter(Boolean).join(' ');
  $('start-test').textContent = hasPractice ? 'Mulai latihan' : 'Mulai tes';
  $('settings-loading').hidden = true;
  $('instructions-body').hidden = false;
  $('instructions-title').focus();
}

$('instructions-title').tabIndex = -1;
$('settings-retry').addEventListener('click', openInstructions);
$('start-test').addEventListener('click', () => startSession(settings.practiceSessions > 0 ? 'practice' : 'main'));

// Test runner

function setStimulus(text, scale = 1, color = null) {
  $('stimulus').textContent = text;
  $('stimulus').className = color ? `stimulus color-${color}` : 'stimulus';
  $('stimulus').style.setProperty('--digit-scale', scale);
  $('stimulus-reason').textContent = '';
  $('stimulus-lead').hidden = true;
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

// 3, 2, 1 before the first digit, and again when the test resumes (PLAN.md §9 D32),
// with a line above the number (PLAN.md §9 D35).
function countdown(then) {
  for (let i = 0; i < COUNTDOWN_FROM; i++) {
    later(i * COUNTDOWN_STEP_MS, () => {
      setStimulus(String(COUNTDOWN_FROM - i));
      $('stimulus-lead').textContent = COUNTDOWN_LABEL;
      $('stimulus-lead').hidden = false;
    });
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

// kind is 'practice' or 'main'. Practice uses every test setting except its own length,
// and is the only place feedback is shown (PLAN.md §9 D33).
function startSession(kind) {
  const practice = kind === 'practice';
  const totalTrials = practice ? settings.practiceTrials : settings.totalTrials;
  run = {
    kind,
    practiceNo: practice ? practiceDone + 1 : null,
    settings: { ...settings, totalTrials },
    feedbackMode: practice ? settings.feedbackMode : 'off',
    sequence: generateSequence(totalTrials, settings.targetFrequency, { balanced: settings.balancedDigits }),
    // Sizes and colors are drawn up front so a replayed trial (PLAN.md §9 D19) keeps them.
    fontSizes: settings.randomFontSize ? generateFontSizes(totalTrials) : null,
    fontColors: settings.randomFontColor ? generateFontColors(totalTrials) : null,
    trials: [],
    index: 0,
    current: null,
    onset: 0,
    accepting: false,
    inputTypes: [],
    tabHiddenCount: 0,
    timers: [],
    paused: false,
    // Session length: from the start of the countdown to the end (PLAN.md §9 D35).
    startedAt: new Date().toISOString(),
    startedPerf: performance.now(),
    stoppedPerf: null,
  };
  $('test-practice-tag').hidden = !practice;
  $('test-practice-tag').textContent = `Sesi Latihan ${run.practiceNo} dari ${settings.practiceSessions}`;
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
  const fontColor = run.fontColors ? run.fontColors[run.index] : null;
  run.current.fontColor = fontColor;
  setStimulus(String(run.current.digit), fontSizePt ? fontScale(fontSizePt) : 1, fontColor);
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
  run.stoppedPerf = performance.now();
  clearTimers();
  run.current = null;
  setStimulus('');
  $('end-dialog').showModal();
});

function resumeTest() {
  $('end-dialog').close();
  run.paused = false;
  run.stoppedPerf = null;
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
    kind: run.kind,
    practiceNo: run.practiceNo,
    body: {
      participantName: participant.name,
      participantId: participant.id,
      setCode: participant.setCode,
      status,
      sessionKind: run.kind,
      practiceNo: run.practiceNo,
      visitId: participant.visitId,
      consentAt: participant.consentAt,
      startedAt: run.startedAt,
      // An early end stops the clock when "Akhiri tes" was pressed, not when the dialog closes.
      durationMs: Math.round((run.stoppedPerf ?? performance.now()) - run.startedPerf),
      settings: {
        displayDurationMs: run.settings.displayDurationMs,
        totalTrials: run.settings.totalTrials,
        targetFrequency: run.settings.targetFrequency,
        randomFontSize: run.settings.randomFontSize,
        randomFontColor: run.settings.randomFontColor,
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
      trials: run.trials.map(({ trialNo, digit, responded, rtMs, extraPresses, fontSizePt, fontColor }) => ({
        trialNo, digit, responded, rtMs, extraPresses, fontSizePt, fontColor,
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
  if (result.kind === 'practice') practiceDone += 1;
  showResults(result);
}

$('saving-retry').addEventListener('click', saveResult);

// One screen for every ending (PLAN.md §9 D33): the results of a completed session, then
// what comes next. After a practice: another practice and/or the main session. After the
// main session, or when nothing is left: a closing note and no buttons.
function showResults({ kind, practiceNo, status, summary }) {
  const practice = kind === 'practice';
  const completed = status === 'completed';
  if (practice) {
    $('results-title').textContent = completed ? `Hasil latihan ${practiceNo}` : `Latihan ${practiceNo} dihentikan`;
  } else {
    $('results-title').textContent = completed ? 'Hasil Anda' : 'Sesi utama dihentikan';
  }
  $('result-summary').hidden = !completed;
  if (completed) {
    $('result-accuracy').textContent = `${summary.accuracy}%`;
  }

  const choices = practice
    ? practiceChoices({ practiceDone, practiceSessions: settings.practiceSessions, trialMode: settings.trialMode })
    : { practiceAgain: false, startMain: false };
  $('practice-again').hidden = !choices.practiceAgain;
  $('practice-again').textContent = `Latihan lagi (${practiceDone + 1} dari ${settings.practiceSessions})`;
  $('start-main').hidden = !choices.startMain;
  // With a choice, the main session is the primary action; another practice is secondary.
  $('practice-again').className = choices.startMain ? 'btn-secondary' : 'btn-primary';
  const finished = !choices.practiceAgain && !choices.startMain;
  $('results-question').hidden = finished;
  $('closing-note').hidden = !finished;
  if (practice) $('closing-note').textContent = 'Sesi latihan selesai. Terima kasih.';
  else $('closing-note').textContent = completed ? 'Terima kasih, sesi utama selesai.' : 'Terima kasih atas partisipasi Anda.';
  show('screen-results');
  $('results-title').focus();
}

$('results-title').tabIndex = -1;
$('practice-again').addEventListener('click', () => startSession('practice'));
$('start-main').addEventListener('click', () => startSession('main'));

loadSets();

// Warn before leaving while a test is running or a result is unsaved.
window.addEventListener('beforeunload', (event) => {
  if (run || pendingResult) event.preventDefault();
});
