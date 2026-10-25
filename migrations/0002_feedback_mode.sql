-- Per-trial feedback in trial mode: 'off', 'errors' (mistakes only) or 'all'.
ALTER TABLE settings ADD COLUMN feedback_mode TEXT NOT NULL DEFAULT 'off'
  CHECK (feedback_mode IN ('off', 'errors', 'all'));

-- The feedback mode in force when the session was saved ('off' for real sessions).
ALTER TABLE sessions ADD COLUMN feedback_mode TEXT NOT NULL DEFAULT 'off'
  CHECK (feedback_mode IN ('off', 'errors', 'all'));
