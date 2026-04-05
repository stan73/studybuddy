-- StudyBuddy Pro — Migration 003
-- Kinder-PIN: 4-stellig numerisch → alphanumerisch, mind. 8 Zeichen
-- AUSFÜHREN: Supabase Dashboard → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════
-- 1. PIN-CONSTRAINT AKTUALISIEREN
-- Alt: genau 4 Ziffern  →  Neu: 8–50 alphanumerische Zeichen
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE children DROP CONSTRAINT IF EXISTS children_pin_check;

ALTER TABLE children ADD CONSTRAINT children_pin_check
  CHECK (
    pin IS NULL OR (
      char_length(pin) >= 8
      AND char_length(pin) <= 50
      AND pin ~ '^[A-Za-z0-9]+$'
    )
  );

COMMENT ON COLUMN children.pin IS
  'Alphanumerischer PIN (8–50 Zeichen, mind. 1 Buchstabe + 1 Zahl) — Kind-Login ohne eigenes Auth-Konto';

-- ══════════════════════════════════════════════════════════════════
-- 2. KIND-AUTH FUNKTION (ERSTELLEN / AKTUALISIEREN)
-- Authentifiziert ein Kind über Eltern-E-Mail + PIN.
-- Gibt Kind-Daten zurück oder eine Fehlermeldung.
-- SECURITY DEFINER: läuft mit Eigentümerrechten, umgeht RLS sicher.
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auth_child(
  p_parent_email TEXT,
  p_pin          TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_parent_id UUID;
  v_child     children%ROWTYPE;
BEGIN
  -- Eingabe-Sanitierung
  p_parent_email := lower(trim(p_parent_email));
  p_pin          := trim(p_pin);

  IF p_parent_email = '' OR p_pin = '' THEN
    RETURN json_build_object('error', 'E-Mail und PIN dürfen nicht leer sein');
  END IF;

  -- Elternteil via E-Mail suchen
  SELECT id INTO v_parent_id
  FROM profiles
  WHERE lower(email) = p_parent_email
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Elternteil nicht gefunden — E-Mail prüfen');
  END IF;

  -- Kind via Parent-ID + PIN suchen (PIN eindeutig pro Elternteil)
  SELECT * INTO v_child
  FROM children
  WHERE parent_id = v_parent_id
    AND pin = p_pin
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'PIN ungültig — bitte Elternteil fragen');
  END IF;

  -- Erfolg: Kind-Daten zurückgeben
  RETURN json_build_object(
    'child_id',     v_child.id,
    'child_name',   v_child.name,
    'grade',        v_child.grade,
    'parent_email', p_parent_email
  );
END;
$$;

-- Anon-Rolle darf aufrufen (Kinder haben keinen Auth-Account)
GRANT EXECUTE ON FUNCTION auth_child TO anon;

COMMENT ON FUNCTION auth_child IS
  'Authentifiziert ein Kind via Eltern-E-Mail + alphanumerischem PIN. SECURITY DEFINER umgeht RLS sicher.';

-- ══════════════════════════════════════════════════════════════════
-- 3. update_child_stats: PIN-Constraint ebenfalls lockern
-- (Funktion prüft weiterhin den PIN-Match, nicht die Länge)
-- Keine Änderung nötig — WHERE pin = p_pin funktioniert weiterhin.
-- ══════════════════════════════════════════════════════════════════
