-- Test sets (PLAN.md §9 D38): one settings row per set instead of a single row. SQLite cannot
-- drop the CHECK (id = 1) in place, so the settings table is rebuilt once. The existing row
-- becomes set 'a', "Set A", active.
CREATE TABLE settings_new (
  id INTEGER PRIMARY KEY,
  -- Used in the link (/?set=b) and stored on every session. Lowercase letters, digits and '-'.
  code TEXT NOT NULL UNIQUE
    CHECK (length(code) BETWEEN 1 AND 20 AND code NOT GLOB '*[^a-z0-9-]*'),
  -- Shown to participants.
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
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
  practice_trials INTEGER NOT NULL DEFAULT 18 CHECK (practice_trials BETWEEN 10 AND 500),
  random_font_color INTEGER NOT NULL DEFAULT 0 CHECK (random_font_color IN (0, 1))
);

INSERT INTO settings_new (id, code, label, is_active, display_duration_ms, total_trials, target_frequency,
  trial_mode, updated_at, feedback_mode, random_font_size, balanced_digits, mask_ms, response_mode,
  practice_sessions, practice_trials, random_font_color)
SELECT 1, 'a', 'Set A', 1, display_duration_ms, total_trials, target_frequency,
  trial_mode, updated_at, feedback_mode, random_font_size, balanced_digits, mask_ms, response_mode,
  practice_sessions, practice_trials, random_font_color
FROM settings;

DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;

-- The set the session was taken in. Empty for sessions saved before sets existed.
ALTER TABLE sessions ADD COLUMN set_code TEXT;
-- The attempt number is now counted per participant, per set and per is_trial (D4, D38).
DROP INDEX sessions_participant;
CREATE INDEX sessions_participant ON sessions (participant_id, set_code, is_trial);
