-- Digit duration and mask become free numbers (PLAN.md §9 D34). SQLite cannot change the CHECK
-- on settings.mask_ms in place, so the single-row settings table is rebuilt once with the new
-- ranges. The existing row is copied unchanged.
CREATE TABLE settings_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_duration_ms INTEGER NOT NULL CHECK (display_duration_ms BETWEEN 100 AND 2000),
  total_trials INTEGER NOT NULL,
  target_frequency REAL NOT NULL,
  trial_mode INTEGER NOT NULL CHECK (trial_mode IN (0, 1)),
  updated_at TEXT NOT NULL,
  feedback_mode TEXT NOT NULL DEFAULT 'off' CHECK (feedback_mode IN ('off', 'errors', 'all')),
  random_font_size INTEGER NOT NULL DEFAULT 0 CHECK (random_font_size IN (0, 1)),
  balanced_digits INTEGER NOT NULL DEFAULT 0 CHECK (balanced_digits IN (0, 1)),
  mask_ms INTEGER NOT NULL DEFAULT 0 CHECK (mask_ms = 0 OR mask_ms BETWEEN 100 AND 2000),
  response_mode TEXT NOT NULL DEFAULT 'classic' CHECK (response_mode IN ('classic', 'wait_mask')),
  practice_sessions INTEGER NOT NULL DEFAULT 1 CHECK (practice_sessions BETWEEN 0 AND 5),
  practice_trials INTEGER NOT NULL DEFAULT 18 CHECK (practice_trials BETWEEN 10 AND 500)
);

INSERT INTO settings_new (id, display_duration_ms, total_trials, target_frequency, trial_mode, updated_at,
  feedback_mode, random_font_size, balanced_digits, mask_ms, response_mode, practice_sessions, practice_trials)
SELECT id, display_duration_ms, total_trials, target_frequency, trial_mode, updated_at,
  feedback_mode, random_font_size, balanced_digits, mask_ms, response_mode, practice_sessions, practice_trials
FROM settings;

DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;

-- When the countdown started (UTC) and the time from then until the session ended, in ms.
-- Empty for sessions saved before this column existed.
ALTER TABLE sessions ADD COLUMN started_at TEXT;
ALTER TABLE sessions ADD COLUMN duration_ms INTEGER;
