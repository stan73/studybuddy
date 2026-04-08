-- ============================================================
-- Migration 006: Schools table + profile school fields
-- StudyBuddy Pro — Schulauswahl aus validierter Liste
-- ============================================================

-- 1. Schulen-Tabelle (befüllt via jedeschule.codefor.de API)
CREATE TABLE IF NOT EXISTS schools (
  id          text PRIMARY KEY,        -- z.B. "BY-01234" (Bundesland-Prefix + lokale ID)
  name        text NOT NULL,
  address     text,
  zip         text,
  city        text NOT NULL,
  state       text NOT NULL,           -- Bundesland-Kürzel: BY, NW, BW, …
  school_type text,                    -- Gymnasium, Grundschule, Realschule, …
  provider    text,                    -- "public" | "private"
  website     text,
  phone       text,
  email       text,
  source      text DEFAULT 'jedeschule',
  updated_at  timestamptz DEFAULT now()
);

-- Volltextsuche auf Name + Stadt (Deutsch)
CREATE INDEX IF NOT EXISTS schools_fts_idx
  ON schools USING gin(to_tsvector('german', name || ' ' || city));

-- Schnelles Filtern nach Bundesland
CREATE INDEX IF NOT EXISTS schools_state_idx ON schools(state);
CREATE INDEX IF NOT EXISTS schools_city_idx  ON schools(city);
CREATE INDEX IF NOT EXISTS schools_zip_idx   ON schools(zip);

-- 2. Schulinfos in profiles ergänzen
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS school_id   text REFERENCES schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS class_name  text;   -- z.B. "10b", "Q1", "6a"

-- 3. Supabase Row Level Security für schools (öffentlich lesbar)
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schools_read_all" ON schools;
CREATE POLICY "schools_read_all"
  ON schools FOR SELECT
  TO authenticated, anon
  USING (true);

-- Nur Service Role darf schreiben (Import-Script nutzt service_role key)
DROP POLICY IF EXISTS "schools_write_service" ON schools;
CREATE POLICY "schools_write_service"
  ON schools FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Hilfsfunktion: Schulsuche per Autocomplete
-- Aufruf: SELECT * FROM search_schools('Goethe', 'BY', 20);
CREATE OR REPLACE FUNCTION search_schools(
  query     text,
  p_state   text DEFAULT NULL,
  p_limit   int  DEFAULT 20
)
RETURNS TABLE (
  id          text,
  name        text,
  city        text,
  zip         text,
  state       text,
  school_type text
)
LANGUAGE sql STABLE AS $$
  SELECT id, name, city, zip, state, school_type
  FROM schools
  WHERE
    to_tsvector('german', name || ' ' || city) @@ plainto_tsquery('german', query)
    AND (p_state IS NULL OR schools.state = p_state)
  ORDER BY ts_rank(to_tsvector('german', name || ' ' || city), plainto_tsquery('german', query)) DESC
  LIMIT p_limit;
$$;

-- Berechtigung: alle authentifizierten User dürfen suchen
GRANT EXECUTE ON FUNCTION search_schools TO authenticated, anon;
