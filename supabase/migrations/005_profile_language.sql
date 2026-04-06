-- Migration 005: Sprachpräferenz für alle Nutzer (Eltern, Schüler, Lehrer)
-- Run in Supabase Dashboard → SQL Editor

-- 1. language-Spalte zur profiles-Tabelle hinzufügen
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language text DEFAULT 'de';

-- 2. Gültige Werte einschränken (de / en / fr / es)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_language_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_language_check
  CHECK (language IN ('de', 'en', 'fr', 'es'));

-- 3. Bestehende Zeilen auf 'de' setzen falls NULL
UPDATE profiles SET language = 'de' WHERE language IS NULL;
