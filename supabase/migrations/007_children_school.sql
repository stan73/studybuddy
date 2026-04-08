-- ============================================================
-- Migration 007: school_id, class_name, email für children
-- ============================================================

ALTER TABLE children
  ADD COLUMN IF NOT EXISTS school_id   text REFERENCES schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS class_name  text,
  ADD COLUMN IF NOT EXISTS email       text;
