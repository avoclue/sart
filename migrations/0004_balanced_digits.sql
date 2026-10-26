-- Balanced digits: the non-3 digits appear equally often in a session (PLAN.md §9 D29).
-- Off by default, which keeps the reference's random draw.
ALTER TABLE settings ADD COLUMN balanced_digits INTEGER NOT NULL DEFAULT 0
  CHECK (balanced_digits IN (0, 1));

ALTER TABLE sessions ADD COLUMN balanced_digits INTEGER NOT NULL DEFAULT 0
  CHECK (balanced_digits IN (0, 1));
