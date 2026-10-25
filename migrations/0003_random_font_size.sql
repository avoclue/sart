-- Random digit font size, as in classic SART (Robertson et al., 1997). Off by default.
ALTER TABLE settings ADD COLUMN random_font_size INTEGER NOT NULL DEFAULT 0
  CHECK (random_font_size IN (0, 1));

ALTER TABLE sessions ADD COLUMN random_font_size INTEGER NOT NULL DEFAULT 0
  CHECK (random_font_size IN (0, 1));

-- Size shown on this trial, in the paper's pt values (48, 72, 94, 100 or 120);
-- 120 is the normal digit size. Empty when random font size was off.
ALTER TABLE trials ADD COLUMN font_size_pt INTEGER
  CHECK (font_size_pt IS NULL OR font_size_pt IN (48, 72, 94, 100, 120));
