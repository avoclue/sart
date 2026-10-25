-- Single-row settings table, read by the participant app, written by the admin.
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_duration_ms INTEGER NOT NULL,
  total_trials INTEGER NOT NULL,
  target_frequency REAL NOT NULL,
  trial_mode INTEGER NOT NULL CHECK (trial_mode IN (0, 1)),
  updated_at TEXT NOT NULL
);

INSERT INTO settings (id, display_duration_ms, total_trials, target_frequency, trial_mode, updated_at)
VALUES (1, 500, 100, 0.2, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  participant_id_raw TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  is_trial INTEGER NOT NULL CHECK (is_trial IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('completed', 'aborted')),
  consent_at TEXT NOT NULL,
  display_duration_ms INTEGER NOT NULL,
  total_trials INTEGER NOT NULL,
  target_frequency REAL NOT NULL,
  trials_completed INTEGER NOT NULL,
  correct_hits INTEGER NOT NULL,
  commission_errors INTEGER NOT NULL,
  omission_errors INTEGER NOT NULL,
  correct_withholds INTEGER NOT NULL,
  accuracy INTEGER,
  mean_rt_ms REAL,
  sd_rt_ms REAL,
  rt_cv REAL,
  commission_rate REAL,
  omission_rate REAL,
  anticipation_count INTEGER NOT NULL,
  user_agent TEXT,
  screen_width INTEGER,
  screen_height INTEGER,
  input_type TEXT NOT NULL,
  tab_hidden_count INTEGER NOT NULL
);

CREATE INDEX sessions_participant ON sessions (participant_id, is_trial);

CREATE TABLE trials (
  session_id TEXT NOT NULL REFERENCES sessions (id),
  trial_no INTEGER NOT NULL,
  digit INTEGER NOT NULL,
  is_target INTEGER NOT NULL,
  responded INTEGER NOT NULL,
  rt_ms REAL,
  outcome TEXT NOT NULL CHECK (outcome IN ('hit', 'omission', 'commission', 'withhold')),
  extra_presses INTEGER NOT NULL,
  PRIMARY KEY (session_id, trial_no)
);
