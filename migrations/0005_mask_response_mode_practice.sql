-- Mask after each digit (PLAN.md §9 D30), response mode (D31) and the practice flow (D33).

ALTER TABLE settings ADD COLUMN mask_ms INTEGER NOT NULL DEFAULT 0
  CHECK (mask_ms IN (0, 500, 900, 1150));
ALTER TABLE settings ADD COLUMN response_mode TEXT NOT NULL DEFAULT 'classic'
  CHECK (response_mode IN ('classic', 'wait_mask'));
ALTER TABLE settings ADD COLUMN practice_sessions INTEGER NOT NULL DEFAULT 1
  CHECK (practice_sessions BETWEEN 0 AND 5);
ALTER TABLE settings ADD COLUMN practice_trials INTEGER NOT NULL DEFAULT 18
  CHECK (practice_trials BETWEEN 10 AND 500);

ALTER TABLE sessions ADD COLUMN mask_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN response_mode TEXT NOT NULL DEFAULT 'classic';
-- Presses on a non-3 before the mask in 'wait_mask' mode.
ALTER TABLE sessions ADD COLUMN early_count INTEGER NOT NULL DEFAULT 0;
-- 1, 2, ... for practice sessions in a visit; empty for a main session or an older session.
ALTER TABLE sessions ADD COLUMN practice_no INTEGER;
-- Shared by every session of one visit (form submitted once); empty for older sessions.
ALTER TABLE sessions ADD COLUMN visit_id TEXT;
CREATE INDEX sessions_visit ON sessions (visit_id);

-- SQLite cannot change a CHECK constraint in place, so the trials table is rebuilt once to
-- allow the new 'early' outcome. Every existing row is copied unchanged.
PRAGMA defer_foreign_keys = true;

CREATE TABLE trials_new (
  session_id TEXT NOT NULL REFERENCES sessions (id),
  trial_no INTEGER NOT NULL,
  digit INTEGER NOT NULL,
  is_target INTEGER NOT NULL,
  responded INTEGER NOT NULL,
  -- From the cue: digit onset (classic) or mask onset ('wait_mask', negative when early).
  rt_ms REAL,
  outcome TEXT NOT NULL CHECK (outcome IN ('hit', 'omission', 'commission', 'withhold', 'early')),
  extra_presses INTEGER NOT NULL,
  font_size_pt INTEGER CHECK (font_size_pt IS NULL OR font_size_pt IN (48, 72, 94, 100, 120)),
  PRIMARY KEY (session_id, trial_no)
);

INSERT INTO trials_new (session_id, trial_no, digit, is_target, responded, rt_ms, outcome, extra_presses, font_size_pt)
SELECT session_id, trial_no, digit, is_target, responded, rt_ms, outcome, extra_presses, font_size_pt FROM trials;

DROP TABLE trials;
ALTER TABLE trials_new RENAME TO trials;
