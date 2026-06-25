-- Migration 010: Free-Tier-Limit für KI-Anfragen (Backlog P0.3)
-- Tagesgenaue Zählung pro Account; vom ai-proxy (SERVICE_ROLE) gepflegt.
-- Free-Nutzer: max. N KI-Anfragen/Tag; bezahlte Pläne: unbegrenzt.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_usage (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day     DATE NOT NULL DEFAULT CURRENT_DATE,
  count   INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, day)
);
COMMENT ON TABLE ai_usage IS 'Tägliche KI-Anfragen pro Account (Free-Tier-Limit). Nur via SERVICE_ROLE im ai-proxy.';

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
-- Kein anon/authenticated-Zugriff: nur die Edge Function (SERVICE_ROLE, RLS-Bypass) schreibt/liest.
-- Eltern dürfen ihren eigenen Verbrauch lesen (für UI-Anzeige „X/Y heute").
CREATE POLICY "ai_usage_own_read" ON ai_usage FOR SELECT USING (auth.uid() = user_id);

-- Atomare Zählung + Limit-Prüfung in einem Schritt (vom Proxy mit SERVICE_ROLE aufgerufen).
-- Gibt true zurück, wenn die Anfrage erlaubt ist (und zählt sie hoch), sonst false.
CREATE OR REPLACE FUNCTION consume_ai_quota(p_user_id UUID, p_limit INT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT;
BEGIN
  INSERT INTO ai_usage (user_id, day, count) VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, day) DO UPDATE SET count = ai_usage.count + 1
  RETURNING count INTO v_count;
  -- Erlaubt, solange der neue Zählerstand das Limit nicht überschreitet.
  RETURN v_count <= p_limit;
END; $$;
-- Nur SERVICE_ROLE (Proxy) ruft dies auf — kein Grant an anon/authenticated.
REVOKE EXECUTE ON FUNCTION consume_ai_quota(UUID, INT) FROM PUBLIC;
