-- Härtung Stufe 1 / Punkt 1.0 — 2026-09-02
-- Eltern-Cloud-Persistenz reparieren: sync_my_data / load_my_data
--
-- Befund (in Produktion verifiziert): Beide Funktionen rufen auth.uid(), liefen
-- aber als SECURITY INVOKER, also als Rolle `authenticated`. Diese Rolle hat
-- EXECUTE auf auth.uid(), aber KEIN USAGE auf dem Schema `auth`
-- (has_schema_privilege('authenticated','auth','USAGE') = false). Jeder Aufruf
-- scheiterte mit 42501 "permission denied for schema auth" — die Eltern-
-- Persistenz hat in Produktion nie geschrieben oder gelesen (cards = 0 Zeilen).
--
-- Fix: SECURITY DEFINER (läuft als neondb_owner, der USAGE auf `auth` hat) —
-- analog zu get_configured_providers / sync_child_data. Bewusst KEIN
-- "GRANT USAGE ON SCHEMA auth TO authenticated": das würde das ganze Schema
-- (auth.jwt(), auth.session(), ...) für die Rolle öffnen.
--
-- Sicherheit: SECURITY DEFINER umgeht RLS. Die Rümpfe sind deshalb strikt auf
-- den Aufrufer eingegrenzt — jedes SELECT/DELETE filtert
-- `user_id = v_uid AND child_id IS NULL`, jedes INSERT setzt user_id = v_uid
-- (nie aus dem Payload). auth.uid() (pg_session_jwt, C-Funktion) liest die per
-- JWT initialisierte Session und ist vom Rollenwechsel unabhängig.
-- search_path = public, pg_temp: pg_temp explizit ans Ende, damit temporäre
-- Objekte die Tabellenauflösung nicht kapern können.
-- Least Privilege: EXECUTE nur noch für `authenticated` (nicht PUBLIC/anonymous);
-- für anonyme Aufrufer würde ohnehin 'not authenticated' geworfen.
--
-- Nicht angefasst: Sync-Semantik (Konflikterkennung = Punkt 1.1).

CREATE OR REPLACE FUNCTION public.load_my_data()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN json_build_object(
    'cards', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, front, back, level, due_at, ease, reps, interval_days, topic, exam_name, exam_date, explain FROM cards WHERE user_id = v_uid AND child_id IS NULL) x), '[]'::json),
    'tasks', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, title, subject, due_at, completed FROM tasks WHERE user_id = v_uid AND child_id IS NULL) x), '[]'::json),
    'exams', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, score, total, created_at FROM exams WHERE user_id = v_uid AND child_id IS NULL) x), '[]'::json)
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.sync_my_data(p_cards jsonb DEFAULT '[]'::jsonb, p_tasks jsonb DEFAULT '[]'::jsonb, p_exams jsonb DEFAULT '[]'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  DELETE FROM cards WHERE user_id = v_uid AND child_id IS NULL;
  DELETE FROM tasks WHERE user_id = v_uid AND child_id IS NULL;
  DELETE FROM exams WHERE user_id = v_uid AND child_id IS NULL;
  INSERT INTO cards (id, user_id, subject, front, back, level, due_at, ease, reps, interval_days, topic, exam_name, exam_date, explain)
    SELECT COALESCE(NULLIF(c->>'id','')::uuid, gen_random_uuid()),
           v_uid, c->>'subject', c->>'front', c->>'back',
           COALESCE((c->>'level')::int, 0), COALESCE((c->>'due_at')::timestamptz, NOW()),
           COALESCE((c->>'ease')::numeric, 2.5), COALESCE((c->>'reps')::int, 0),
           COALESCE((c->>'interval_days')::int, 0), NULLIF(c->>'topic',''),
           NULLIF(c->>'exam_name',''), NULLIF(c->>'exam_date','')::date, NULLIF(c->>'explain','')
    FROM jsonb_array_elements(COALESCE(p_cards,'[]'::jsonb)) c;
  INSERT INTO tasks (id, user_id, title, subject, due_at, completed)
    SELECT COALESCE(NULLIF(t->>'id','')::uuid, gen_random_uuid()),
           v_uid, t->>'title', NULLIF(t->>'subject',''), NULLIF(t->>'due_at','')::date,
           COALESCE((t->>'completed')::boolean, false)
    FROM jsonb_array_elements(COALESCE(p_tasks,'[]'::jsonb)) t;
  INSERT INTO exams (id, user_id, subject, score, total, created_at)
    SELECT COALESCE(NULLIF(e->>'id','')::uuid, gen_random_uuid()),
           v_uid, e->>'subject', (e->>'score')::int, (e->>'total')::int,
           COALESCE((e->>'created_at')::timestamptz, NOW())
    FROM jsonb_array_elements(COALESCE(p_exams,'[]'::jsonb)) e;
END; $function$;

REVOKE ALL ON FUNCTION public.load_my_data() FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.sync_my_data(jsonb, jsonb, jsonb) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.load_my_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_my_data(jsonb, jsonb, jsonb) TO authenticated;
