-- Random digit color: red, yellow or blue, balanced over a session (PLAN.md §9 D37). Off by default.
ALTER TABLE settings ADD COLUMN random_font_color INTEGER NOT NULL DEFAULT 0
  CHECK (random_font_color IN (0, 1));

ALTER TABLE sessions ADD COLUMN random_font_color INTEGER NOT NULL DEFAULT 0
  CHECK (random_font_color IN (0, 1));

-- Color shown on this trial. Empty when random font color was off.
ALTER TABLE trials ADD COLUMN font_color TEXT
  CHECK (font_color IS NULL OR font_color IN ('red', 'yellow', 'blue'));
