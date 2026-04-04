-- StudyBuddy Pro — Migration 002
-- API-Keys sicher im Backend · Kind-Stats für Eltern-Dashboard
-- ─────────────────────────────────────────────────────────────────────────
-- AUSFÜHREN: Supabase Dashboard → SQL Editor → Run

-- ══════════════════════════════════════════════════════════════════
-- 1. API-KEYS TABELLE
-- Nutzer-API-Keys werden ausschliesslich server-seitig gespeichert.
-- RLS: Schreiben ja, Lesen nein (nur Edge Function via Service Role)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS api_keys (
  user_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'openai', 'gemini')),
  api_key  TEXT NOT NULL CHECK (char_length(api_key) BETWEEN 20 AND 500),
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, provider)
);
COMMENT ON TABLE api_keys IS
  'Nutzer-API-Keys — nur via Edge Function (Service Role) lesbar, nie direkt ans Frontend';

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Nutzer können SCHREIBEN und LÖSCHEN — aber NICHT LESEN
-- (Schlüssel verlassen den Server nach dem Speichern nie wieder)
CREATE POLICY "api_keys_write" ON api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "api_keys_update" ON api_keys
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "api_keys_delete" ON api_keys
  FOR DELETE USING (auth.uid() = user_id);

-- ══════════════════════════════════════════════════════════════════
-- 2. FUNKTION: Konfigurierte Provider zurückgeben (OHNE Key)
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_configured_providers()
RETURNS TABLE(provider TEXT) AS $$
BEGIN
  RETURN QUERY
    SELECT ak.provider
    FROM api_keys ak
    WHERE ak.user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_configured_providers TO authenticated;
COMMENT ON FUNCTION get_configured_providers IS
  'Gibt nur Provider-Namen zurück — kein API-Key. Sicher für Frontend-Nutzung.';

-- ══════════════════════════════════════════════════════════════════
-- 3. KINDER-TABELLE: PIN + STATS ERGÄNZEN
-- ══════════════════════════════════════════════════════════════════

-- PIN-Spalte (falls noch nicht vorhanden)
ALTER TABLE children ADD COLUMN IF NOT EXISTS
  pin TEXT CHECK (pin IS NULL OR pin ~ '^\d{4}$');

-- Stats JSONB für Eltern-Dashboard (kein separates User-Account nötig)
ALTER TABLE children ADD COLUMN IF NOT EXISTS
  stats JSONB NOT NULL DEFAULT '{
    "xp": 0,
    "streak": 0,
    "correct": 0,
    "total": 0,
    "lastStudy": null,
    "weeklyXP": [0,0,0,0,0,0,0]
  }'::jsonb;

COMMENT ON COLUMN children.stats IS
  'Aggregierte Lernstatistiken des Kindes — wird via update_child_stats() geschrieben';

-- ══════════════════════════════════════════════════════════════════
-- 4. FUNKTION: Kind-Stats aktualisieren (ohne JWT, via PIN-Verifikation)
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_child_stats(
  p_child_id   UUID,
  p_pin        TEXT,
  p_xp         INTEGER,
  p_streak     INTEGER,
  p_correct    INTEGER,
  p_total      INTEGER,
  p_weekly_xp  JSONB  -- Array mit 7 Zahlen [Mo..So]
)
RETURNS BOOLEAN AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE children
  SET stats = jsonb_build_object(
    'xp',       p_xp,
    'streak',   p_streak,
    'correct',  p_correct,
    'total',    p_total,
    'lastStudy', NOW(),
    'weeklyXP', p_weekly_xp
  )
  WHERE id = p_child_id
    AND pin = p_pin;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Anon-Rolle darf diese Funktion aufrufen (Kind hat kein Auth-Account)
GRANT EXECUTE ON FUNCTION update_child_stats TO anon;
COMMENT ON FUNCTION update_child_stats IS
  'Schreibt Kind-Stats nach PIN-Verifikation — SECURITY DEFINER umgeht RLS sicher';

-- ══════════════════════════════════════════════════════════════════
-- 5. RLS FÜR CHILDREN: Eltern dürfen auch stats-Spalte lesen
-- (bestehende Policy "children_own" deckt das bereits ab)
-- ══════════════════════════════════════════════════════════════════
-- Keine zusätzliche Policy nötig — children_own FOR ALL gilt weiterhin.
