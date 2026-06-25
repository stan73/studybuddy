-- Migration 008: Cloud-Persistenz für Karten / Aufgaben / Prüfungen
-- Ziel (Backlog P0.1): cards/tasks/exams geräteübergreifend in Supabase statt nur localStorage.
--
-- Architektur:
--   • Eltern/Schüler (authentifiziert, JWT): Daten via RLS (auth.uid() = user_id), child_id = NULL.
--   • Kinder (kein Auth-Account): Zugriff ausschließlich über PIN-verifizierte SECURITY-DEFINER-RPCs
--     (Muster wie bestehendes auth_child / update_child_stats). Kind-Zeilen: user_id = parent_id, child_id = kind.
--   • Persistenz folgt der bestehenden save()-Semantik (Ganz-Ersetzen des Daten-Blobs) → transaktional in RPCs.
--
-- AUSFÜHREN: Supabase Dashboard → SQL Editor (oder via apply_migration im development-Branch).
-- ─────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════
-- 1. child_id-Spalten (NULL = gehört dem Account-Inhaber selbst)
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE cards    ADD COLUMN IF NOT EXISTS child_id UUID REFERENCES children(id) ON DELETE CASCADE;
ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS child_id UUID REFERENCES children(id) ON DELETE CASCADE;
ALTER TABLE exams    ADD COLUMN IF NOT EXISTS child_id UUID REFERENCES children(id) ON DELETE CASCADE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS child_id UUID REFERENCES children(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS cards_child ON cards(child_id) WHERE child_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_child ON tasks(child_id) WHERE child_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS exams_child ON exams(child_id) WHERE child_id IS NOT NULL;

-- RLS bleibt unverändert: bestehende "*_own"-Policies (auth.uid() = user_id) decken den Eltern/Schüler-Pfad
-- vollständig ab — Kind-Zeilen haben user_id = parent_id, sind also für das Elternteil sichtbar/änderbar.
-- Der Kind-Pfad läuft NICHT über RLS, sondern über die SECURITY-DEFINER-RPCs unten.

-- ══════════════════════════════════════════════════════════════════
-- 2. RPC: Eltern/Schüler-Daten synchronisieren (authentifiziert, atomar)
--    Ersetzt alle eigenen Zeilen (child_id IS NULL) durch die übergebenen Arrays.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sync_my_data(
  p_cards JSONB DEFAULT '[]'::jsonb,
  p_tasks JSONB DEFAULT '[]'::jsonb,
  p_exams JSONB DEFAULT '[]'::jsonb
) RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  DELETE FROM cards WHERE user_id = v_uid AND child_id IS NULL;
  DELETE FROM tasks WHERE user_id = v_uid AND child_id IS NULL;
  DELETE FROM exams WHERE user_id = v_uid AND child_id IS NULL;

  INSERT INTO cards (id, user_id, subject, front, back, level, due_at)
    SELECT COALESCE(NULLIF(c->>'id','')::uuid, gen_random_uuid()),
           v_uid, c->>'subject', c->>'front', c->>'back',
           COALESCE((c->>'level')::int, 0),
           COALESCE((c->>'due_at')::timestamptz, NOW())
    FROM jsonb_array_elements(COALESCE(p_cards,'[]'::jsonb)) c;

  INSERT INTO tasks (id, user_id, title, subject, due_at, completed)
    SELECT COALESCE(NULLIF(t->>'id','')::uuid, gen_random_uuid()),
           v_uid, t->>'title', NULLIF(t->>'subject',''),
           NULLIF(t->>'due_at','')::date,
           COALESCE((t->>'completed')::boolean, false)
    FROM jsonb_array_elements(COALESCE(p_tasks,'[]'::jsonb)) t;

  INSERT INTO exams (id, user_id, subject, score, total, created_at)
    SELECT COALESCE(NULLIF(e->>'id','')::uuid, gen_random_uuid()),
           v_uid, e->>'subject', (e->>'score')::int, (e->>'total')::int,
           COALESCE((e->>'created_at')::timestamptz, NOW())
    FROM jsonb_array_elements(COALESCE(p_exams,'[]'::jsonb)) e;
END; $$;
GRANT EXECUTE ON FUNCTION sync_my_data TO authenticated;
COMMENT ON FUNCTION sync_my_data IS 'Atomares Ganz-Ersetzen der eigenen cards/tasks/exams (RLS via auth.uid()).';

-- ══════════════════════════════════════════════════════════════════
-- 3. RPC: Eigene Daten laden (authentifiziert)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION load_my_data()
RETURNS JSON LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN json_build_object(
    'cards', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, front, back, level, due_at FROM cards WHERE user_id = v_uid AND child_id IS NULL) x), '[]'::json),
    'tasks', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, title, subject, due_at, completed FROM tasks WHERE user_id = v_uid AND child_id IS NULL) x), '[]'::json),
    'exams', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, score, total, created_at FROM exams WHERE user_id = v_uid AND child_id IS NULL) x), '[]'::json)
  );
END; $$;
GRANT EXECUTE ON FUNCTION load_my_data TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 4. RPC: Kind-Daten synchronisieren (anon, PIN-verifiziert, atomar)
--    Ersetzt alle Kind-Zeilen + aktualisiert children.stats in einer Transaktion.
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sync_child_data(
  p_child_id UUID, p_pin TEXT,
  p_cards JSONB DEFAULT '[]'::jsonb,
  p_tasks JSONB DEFAULT '[]'::jsonb,
  p_exams JSONB DEFAULT '[]'::jsonb,
  p_xp INT DEFAULT 0, p_streak INT DEFAULT 0,
  p_correct INT DEFAULT 0, p_total INT DEFAULT 0,
  p_weekly JSONB DEFAULT '[0,0,0,0,0,0,0]'::jsonb
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_parent UUID;
BEGIN
  SELECT parent_id INTO v_parent FROM children WHERE id = p_child_id AND pin = p_pin;
  IF NOT FOUND THEN RETURN false; END IF;

  DELETE FROM cards WHERE child_id = p_child_id;
  DELETE FROM tasks WHERE child_id = p_child_id;
  DELETE FROM exams WHERE child_id = p_child_id;

  INSERT INTO cards (id, user_id, child_id, subject, front, back, level, due_at)
    SELECT COALESCE(NULLIF(c->>'id','')::uuid, gen_random_uuid()),
           v_parent, p_child_id, c->>'subject', c->>'front', c->>'back',
           COALESCE((c->>'level')::int, 0),
           COALESCE((c->>'due_at')::timestamptz, NOW())
    FROM jsonb_array_elements(COALESCE(p_cards,'[]'::jsonb)) c;

  INSERT INTO tasks (id, user_id, child_id, title, subject, due_at, completed)
    SELECT COALESCE(NULLIF(t->>'id','')::uuid, gen_random_uuid()),
           v_parent, p_child_id, t->>'title', NULLIF(t->>'subject',''),
           NULLIF(t->>'due_at','')::date,
           COALESCE((t->>'completed')::boolean, false)
    FROM jsonb_array_elements(COALESCE(p_tasks,'[]'::jsonb)) t;

  INSERT INTO exams (id, user_id, child_id, subject, score, total, created_at)
    SELECT COALESCE(NULLIF(e->>'id','')::uuid, gen_random_uuid()),
           v_parent, p_child_id, e->>'subject', (e->>'score')::int, (e->>'total')::int,
           COALESCE((e->>'created_at')::timestamptz, NOW())
    FROM jsonb_array_elements(COALESCE(p_exams,'[]'::jsonb)) e;

  UPDATE children SET stats = jsonb_build_object(
    'xp', p_xp, 'streak', p_streak, 'correct', p_correct, 'total', p_total,
    'lastStudy', NOW(), 'weeklyXP', COALESCE(p_weekly,'[0,0,0,0,0,0,0]'::jsonb)
  ) WHERE id = p_child_id;

  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION sync_child_data TO anon;
COMMENT ON FUNCTION sync_child_data IS 'PIN-verifiziertes Ganz-Ersetzen der Kind-Daten + Stats (SECURITY DEFINER umgeht RLS sicher).';

-- ══════════════════════════════════════════════════════════════════
-- 5. RPC: Kind-Daten laden (anon, PIN-verifiziert)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION load_child_data(p_child_id UUID, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok UUID;
BEGIN
  SELECT id INTO v_ok FROM children WHERE id = p_child_id AND pin = p_pin;
  IF NOT FOUND THEN RETURN json_build_object('error', 'pin'); END IF;
  RETURN json_build_object(
    'cards', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, front, back, level, due_at FROM cards WHERE child_id = p_child_id) x), '[]'::json),
    'tasks', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, title, subject, due_at, completed FROM tasks WHERE child_id = p_child_id) x), '[]'::json),
    'exams', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, score, total, created_at FROM exams WHERE child_id = p_child_id) x), '[]'::json),
    'stats', (SELECT stats FROM children WHERE id = p_child_id)
  );
END; $$;
GRANT EXECUTE ON FUNCTION load_child_data TO anon;
COMMENT ON FUNCTION load_child_data IS 'PIN-verifiziertes Laden der Kind-Daten (cards/tasks/exams/stats).';
