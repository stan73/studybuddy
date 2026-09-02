-- Härtung Stufe 1 / Punkt 1.1 — 2026-09-02
-- Sync mit Konflikterkennung statt Ganz-Ersetzen (Eltern- UND Kind-Pfad)
--
-- Befund: sync_my_data und sync_child_data führten `DELETE …; INSERT …` mit dem
-- kompletten Client-Blob aus — ohne Version, ohne Vergleich. Zwei Geräte
-- (Szenario A) oder ein Offline-Gerät (Szenario B) überschrieben sich damit
-- gegenseitig; der zuletzt Schreibende gewann, alles andere war weg. Das
-- PITR-Fenster (Neon Free) beträgt 6 h — danach unwiederbringlich.
--
-- Änderung (nur additiv am Schema, Funktionen ersetzt):
--   1. Tabelle sync_state(scope_id → data_version): ein monotoner Zähler pro
--      Datensatz. scope_id = user_id (Eltern/Schüler, child_id IS NULL) bzw.
--      child_id (Kind). Keine Policies, kein Client-Zugriff — nur die
--      SECURITY-DEFINER-Funktionen lesen/schreiben sie.
--   2. cards/tasks/exams bekommen updated_at (serverseitig mit clock_timestamp()
--      gestempelt — NOW() wäre transaktionsstabil — und nur, wenn sich der
--      Inhalt der Zeile wirklich geändert hat). Das ist Anzeige- und
--      Entscheidungshilfe für den Client-Merge — die Änderungserkennung selbst
--      läuft im Client über Inhalts-Hashes gegen den letzten Sync-Stand
--      (js/sync-merge.js) und ist damit unabhängig von Geräteuhren.
--   3. sync_my_data / sync_child_data nehmen p_base_version entgegen:
--        NULL              → PT428 'sync_version_required' (alter Client; nichts
--                            wird geschrieben — der Client zeigt seinen
--                            Sync-Fehler und behält die Daten lokal)
--        ≠ Server-Version  → PT409 'sync_conflict' mit DETAIL {server_version,
--                            client_version}; nichts wird geschrieben
--        = Server-Version  → Upsert (Inhalt + updated_at nur bei Änderung),
--                            fehlende Zeilen löschen, Version +1, Rückgabe
--                            {ok, version, updated_at}
--      Race zweier gleichzeitiger Schreiber: SELECT … FOR UPDATE auf der
--      sync_state-Zeile serialisiert; der zweite sieht die neue Version und
--      bekommt PT409.
--      SQLSTATE 'PTxxx' → PostgREST antwortet mit HTTP xxx (409/428) und liefert
--      code/message/details im Fehlerobjekt — unterscheidbar, kein generischer
--      Fehler.
--   4. load_my_data / load_child_data liefern 'version' und je Zeile updated_at.
--
-- Sicherheit: unverändert SECURITY DEFINER mit search_path = public, pg_temp,
-- jedes Statement auf den Aufrufer eingegrenzt (user_id = v_uid AND child_id IS
-- NULL bzw. child_id = p_child_id). Der Upsert greift per ON CONFLICT (id) nur,
-- wenn die vorhandene Zeile zum Aufrufer gehört (WHERE im DO UPDATE) — eine
-- untergeschobene fremde id wird weder eingefügt noch verändert.
-- Rückgabetyp-Wechsel (void/boolean → jsonb) erzwingt DROP + CREATE; die ACLs
-- werden danach explizit neu gesetzt.
--
-- Abwärtskompatibilität: Ein Client mit altem Code (kein p_base_version) bekommt
-- PT428 und zeigt „Cloud-Sync fehlgeschlagen — Änderungen vorerst nur auf diesem
-- Gerät“; er kann nichts mehr überschreiben. Der Service Worker liefert HTML
-- Network-First, d. h. der nächste Seitenaufruf bringt den neuen Client, der
-- lokale und Cloud-Daten zusammenführt (Union, keine Löschungen ohne Basis).

BEGIN;

-- 1. Versionszähler ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_state (
  scope_id     uuid PRIMARY KEY,
  data_version bigint      NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sync_state FROM PUBLIC, anonymous, authenticated;

-- 2. updated_at je Entität --------------------------------------------------------
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 3. Eltern-/Schüler-Pfad -----------------------------------------------------------
DROP FUNCTION IF EXISTS public.sync_my_data(jsonb, jsonb, jsonb);

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
    'version', COALESCE((SELECT data_version FROM sync_state WHERE scope_id = v_uid), 0),
    'cards', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, front, back, level, due_at, ease, reps, interval_days, topic, exam_name, exam_date, explain, updated_at
         FROM cards WHERE user_id = v_uid AND child_id IS NULL) x), '[]'::json),
    'tasks', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, title, subject, due_at, completed, updated_at
         FROM tasks WHERE user_id = v_uid AND child_id IS NULL) x), '[]'::json),
    'exams', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, score, total, created_at, updated_at
         FROM exams WHERE user_id = v_uid AND child_id IS NULL) x), '[]'::json)
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.sync_my_data(
  p_cards jsonb DEFAULT '[]'::jsonb,
  p_tasks jsonb DEFAULT '[]'::jsonb,
  p_exams jsonb DEFAULT '[]'::jsonb,
  p_base_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_cur bigint;
  v_new bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_base_version IS NULL THEN
    RAISE EXCEPTION 'sync_version_required'
      USING ERRCODE = 'PT428',
            DETAIL  = json_build_object('server_version',
                        COALESCE((SELECT data_version FROM sync_state WHERE scope_id = v_uid), 0))::text,
            HINT    = 'Client sendet keine Datenversion (veralteter Client) — Seite neu laden.';
  END IF;

  INSERT INTO sync_state (scope_id) VALUES (v_uid) ON CONFLICT (scope_id) DO NOTHING;
  SELECT data_version INTO v_cur FROM sync_state WHERE scope_id = v_uid FOR UPDATE;
  IF v_cur <> p_base_version THEN
    RAISE EXCEPTION 'sync_conflict'
      USING ERRCODE = 'PT409',
            DETAIL  = json_build_object('server_version', v_cur, 'client_version', p_base_version)::text,
            HINT    = 'Serverstand ist neuer — Client muss laden, zusammenführen und erneut schreiben.';
  END IF;

  -- Karten: fehlende löschen, vorhandene aktualisieren (updated_at nur bei Inhaltsänderung), neue einfügen
  DELETE FROM cards WHERE user_id = v_uid AND child_id IS NULL
    AND id NOT IN (SELECT (c->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_cards,'[]'::jsonb)) c
                    WHERE NULLIF(c->>'id','') IS NOT NULL);
  INSERT INTO cards (id, user_id, subject, front, back, level, due_at, ease, reps, interval_days, topic, exam_name, exam_date, explain, updated_at)
    SELECT DISTINCT ON (1) COALESCE(NULLIF(c->>'id','')::uuid, gen_random_uuid()),
           v_uid, c->>'subject', c->>'front', c->>'back',
           COALESCE((c->>'level')::int, 0), COALESCE((c->>'due_at')::timestamptz, NOW()),
           COALESCE((c->>'ease')::numeric, 2.5), COALESCE((c->>'reps')::int, 0),
           COALESCE((c->>'interval_days')::int, 0), NULLIF(c->>'topic',''),
           NULLIF(c->>'exam_name',''), NULLIF(c->>'exam_date','')::date, NULLIF(c->>'explain',''),
           clock_timestamp()
    FROM jsonb_array_elements(COALESCE(p_cards,'[]'::jsonb)) c
  ON CONFLICT (id) DO UPDATE SET
    subject = EXCLUDED.subject, front = EXCLUDED.front, back = EXCLUDED.back,
    level = EXCLUDED.level, due_at = EXCLUDED.due_at, ease = EXCLUDED.ease,
    reps = EXCLUDED.reps, interval_days = EXCLUDED.interval_days, topic = EXCLUDED.topic,
    exam_name = EXCLUDED.exam_name, exam_date = EXCLUDED.exam_date, explain = EXCLUDED.explain,
    updated_at = CASE WHEN (cards.subject, cards.front, cards.back, cards.level, cards.due_at, cards.ease,
                            cards.reps, cards.interval_days, cards.topic, cards.exam_name, cards.exam_date, cards.explain)
                      IS DISTINCT FROM
                      (EXCLUDED.subject, EXCLUDED.front, EXCLUDED.back, EXCLUDED.level, EXCLUDED.due_at, EXCLUDED.ease,
                       EXCLUDED.reps, EXCLUDED.interval_days, EXCLUDED.topic, EXCLUDED.exam_name, EXCLUDED.exam_date, EXCLUDED.explain)
                      THEN clock_timestamp() ELSE cards.updated_at END
  WHERE cards.user_id = v_uid AND cards.child_id IS NULL;

  DELETE FROM tasks WHERE user_id = v_uid AND child_id IS NULL
    AND id NOT IN (SELECT (t->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_tasks,'[]'::jsonb)) t
                    WHERE NULLIF(t->>'id','') IS NOT NULL);
  INSERT INTO tasks (id, user_id, title, subject, due_at, completed, updated_at)
    SELECT DISTINCT ON (1) COALESCE(NULLIF(t->>'id','')::uuid, gen_random_uuid()),
           v_uid, t->>'title', NULLIF(t->>'subject',''), NULLIF(t->>'due_at','')::date,
           COALESCE((t->>'completed')::boolean, false), clock_timestamp()
    FROM jsonb_array_elements(COALESCE(p_tasks,'[]'::jsonb)) t
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, subject = EXCLUDED.subject, due_at = EXCLUDED.due_at, completed = EXCLUDED.completed,
    updated_at = CASE WHEN (tasks.title, tasks.subject, tasks.due_at, tasks.completed)
                      IS DISTINCT FROM (EXCLUDED.title, EXCLUDED.subject, EXCLUDED.due_at, EXCLUDED.completed)
                      THEN clock_timestamp() ELSE tasks.updated_at END
  WHERE tasks.user_id = v_uid AND tasks.child_id IS NULL;

  DELETE FROM exams WHERE user_id = v_uid AND child_id IS NULL
    AND id NOT IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_exams,'[]'::jsonb)) e
                    WHERE NULLIF(e->>'id','') IS NOT NULL);
  INSERT INTO exams (id, user_id, subject, score, total, created_at, updated_at)
    SELECT DISTINCT ON (1) COALESCE(NULLIF(e->>'id','')::uuid, gen_random_uuid()),
           v_uid, e->>'subject', (e->>'score')::int, (e->>'total')::int,
           COALESCE((e->>'created_at')::timestamptz, NOW()), clock_timestamp()
    FROM jsonb_array_elements(COALESCE(p_exams,'[]'::jsonb)) e
  ON CONFLICT (id) DO UPDATE SET
    subject = EXCLUDED.subject, score = EXCLUDED.score, total = EXCLUDED.total, created_at = EXCLUDED.created_at,
    updated_at = CASE WHEN (exams.subject, exams.score, exams.total, exams.created_at)
                      IS DISTINCT FROM (EXCLUDED.subject, EXCLUDED.score, EXCLUDED.total, EXCLUDED.created_at)
                      THEN clock_timestamp() ELSE exams.updated_at END
  WHERE exams.user_id = v_uid AND exams.child_id IS NULL;

  v_new := v_cur + 1;
  UPDATE sync_state SET data_version = v_new, updated_at = clock_timestamp() WHERE scope_id = v_uid;
  RETURN jsonb_build_object('ok', true, 'version', v_new, 'updated_at', clock_timestamp());
END; $function$;

REVOKE ALL ON FUNCTION public.load_my_data() FROM PUBLIC, anonymous;
REVOKE ALL ON FUNCTION public.sync_my_data(jsonb, jsonb, jsonb, bigint) FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.load_my_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_my_data(jsonb, jsonb, jsonb, bigint) TO authenticated;

-- 4. Kind-Pfad (PIN-verifiziert, ohne Auth-Session → auch anonymous) ----------------
DROP FUNCTION IF EXISTS public.sync_child_data(uuid, text, jsonb, jsonb, jsonb, integer, integer, integer, integer, jsonb, integer, integer, bigint);

CREATE OR REPLACE FUNCTION public.load_child_data(p_child_id uuid, p_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_ok UUID;
BEGIN
  SELECT id INTO v_ok FROM children WHERE id = p_child_id AND pin = p_pin;
  IF NOT FOUND THEN RETURN json_build_object('error', 'pin'); END IF;
  RETURN json_build_object(
    'version', COALESCE((SELECT data_version FROM sync_state WHERE scope_id = p_child_id), 0),
    'cards', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, front, back, level, due_at, ease, reps, interval_days, topic, exam_name, exam_date, explain, updated_at
         FROM cards WHERE child_id = p_child_id) x), '[]'::json),
    'tasks', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, title, subject, due_at, completed, updated_at FROM tasks WHERE child_id = p_child_id) x), '[]'::json),
    'exams', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, score, total, created_at, updated_at FROM exams WHERE child_id = p_child_id) x), '[]'::json),
    'stats', (SELECT stats FROM children WHERE id = p_child_id)
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.sync_child_data(
  p_child_id uuid, p_pin text,
  p_cards jsonb DEFAULT '[]'::jsonb, p_tasks jsonb DEFAULT '[]'::jsonb, p_exams jsonb DEFAULT '[]'::jsonb,
  p_xp integer DEFAULT 0, p_streak integer DEFAULT 0, p_correct integer DEFAULT 0, p_total integer DEFAULT 0,
  p_weekly jsonb DEFAULT '[0, 0, 0, 0, 0, 0, 0]'::jsonb,
  p_daily_goal integer DEFAULT 5, p_freezes integer DEFAULT 0, p_lfg bigint DEFAULT NULL::bigint,
  p_base_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_parent UUID;
  v_cur bigint;
  v_new bigint;
BEGIN
  SELECT parent_id INTO v_parent FROM children WHERE id = p_child_id AND pin = p_pin;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'pin'); END IF;
  IF p_base_version IS NULL THEN
    RAISE EXCEPTION 'sync_version_required'
      USING ERRCODE = 'PT428',
            DETAIL  = json_build_object('server_version',
                        COALESCE((SELECT data_version FROM sync_state WHERE scope_id = p_child_id), 0))::text,
            HINT    = 'Client sendet keine Datenversion (veralteter Client) — Seite neu laden.';
  END IF;

  INSERT INTO sync_state (scope_id) VALUES (p_child_id) ON CONFLICT (scope_id) DO NOTHING;
  SELECT data_version INTO v_cur FROM sync_state WHERE scope_id = p_child_id FOR UPDATE;
  IF v_cur <> p_base_version THEN
    RAISE EXCEPTION 'sync_conflict'
      USING ERRCODE = 'PT409',
            DETAIL  = json_build_object('server_version', v_cur, 'client_version', p_base_version)::text,
            HINT    = 'Serverstand ist neuer — Client muss laden, zusammenführen und erneut schreiben.';
  END IF;

  DELETE FROM cards WHERE child_id = p_child_id
    AND id NOT IN (SELECT (c->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_cards,'[]'::jsonb)) c
                    WHERE NULLIF(c->>'id','') IS NOT NULL);
  INSERT INTO cards (id, user_id, child_id, subject, front, back, level, due_at, ease, reps, interval_days, topic, exam_name, exam_date, explain, updated_at)
    SELECT DISTINCT ON (1) COALESCE(NULLIF(c->>'id','')::uuid, gen_random_uuid()),
           v_parent, p_child_id, c->>'subject', c->>'front', c->>'back',
           COALESCE((c->>'level')::int, 0), COALESCE((c->>'due_at')::timestamptz, NOW()),
           COALESCE((c->>'ease')::numeric, 2.5), COALESCE((c->>'reps')::int, 0),
           COALESCE((c->>'interval_days')::int, 0), NULLIF(c->>'topic',''),
           NULLIF(c->>'exam_name',''), NULLIF(c->>'exam_date','')::date, NULLIF(c->>'explain',''),
           clock_timestamp()
    FROM jsonb_array_elements(COALESCE(p_cards,'[]'::jsonb)) c
  ON CONFLICT (id) DO UPDATE SET
    subject = EXCLUDED.subject, front = EXCLUDED.front, back = EXCLUDED.back,
    level = EXCLUDED.level, due_at = EXCLUDED.due_at, ease = EXCLUDED.ease,
    reps = EXCLUDED.reps, interval_days = EXCLUDED.interval_days, topic = EXCLUDED.topic,
    exam_name = EXCLUDED.exam_name, exam_date = EXCLUDED.exam_date, explain = EXCLUDED.explain,
    updated_at = CASE WHEN (cards.subject, cards.front, cards.back, cards.level, cards.due_at, cards.ease,
                            cards.reps, cards.interval_days, cards.topic, cards.exam_name, cards.exam_date, cards.explain)
                      IS DISTINCT FROM
                      (EXCLUDED.subject, EXCLUDED.front, EXCLUDED.back, EXCLUDED.level, EXCLUDED.due_at, EXCLUDED.ease,
                       EXCLUDED.reps, EXCLUDED.interval_days, EXCLUDED.topic, EXCLUDED.exam_name, EXCLUDED.exam_date, EXCLUDED.explain)
                      THEN clock_timestamp() ELSE cards.updated_at END
  WHERE cards.child_id = p_child_id;

  DELETE FROM tasks WHERE child_id = p_child_id
    AND id NOT IN (SELECT (t->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_tasks,'[]'::jsonb)) t
                    WHERE NULLIF(t->>'id','') IS NOT NULL);
  INSERT INTO tasks (id, user_id, child_id, title, subject, due_at, completed, updated_at)
    SELECT DISTINCT ON (1) COALESCE(NULLIF(t->>'id','')::uuid, gen_random_uuid()),
           v_parent, p_child_id, t->>'title', NULLIF(t->>'subject',''), NULLIF(t->>'due_at','')::date,
           COALESCE((t->>'completed')::boolean, false), clock_timestamp()
    FROM jsonb_array_elements(COALESCE(p_tasks,'[]'::jsonb)) t
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, subject = EXCLUDED.subject, due_at = EXCLUDED.due_at, completed = EXCLUDED.completed,
    updated_at = CASE WHEN (tasks.title, tasks.subject, tasks.due_at, tasks.completed)
                      IS DISTINCT FROM (EXCLUDED.title, EXCLUDED.subject, EXCLUDED.due_at, EXCLUDED.completed)
                      THEN clock_timestamp() ELSE tasks.updated_at END
  WHERE tasks.child_id = p_child_id;

  DELETE FROM exams WHERE child_id = p_child_id
    AND id NOT IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_exams,'[]'::jsonb)) e
                    WHERE NULLIF(e->>'id','') IS NOT NULL);
  INSERT INTO exams (id, user_id, child_id, subject, score, total, created_at, updated_at)
    SELECT DISTINCT ON (1) COALESCE(NULLIF(e->>'id','')::uuid, gen_random_uuid()),
           v_parent, p_child_id, e->>'subject', (e->>'score')::int, (e->>'total')::int,
           COALESCE((e->>'created_at')::timestamptz, NOW()), clock_timestamp()
    FROM jsonb_array_elements(COALESCE(p_exams,'[]'::jsonb)) e
  ON CONFLICT (id) DO UPDATE SET
    subject = EXCLUDED.subject, score = EXCLUDED.score, total = EXCLUDED.total, created_at = EXCLUDED.created_at,
    updated_at = CASE WHEN (exams.subject, exams.score, exams.total, exams.created_at)
                      IS DISTINCT FROM (EXCLUDED.subject, EXCLUDED.score, EXCLUDED.total, EXCLUDED.created_at)
                      THEN clock_timestamp() ELSE exams.updated_at END
  WHERE exams.child_id = p_child_id;

  UPDATE children SET stats = jsonb_build_object(
    'xp', p_xp, 'streak', p_streak, 'correct', p_correct, 'total', p_total,
    'lastStudy', NOW(), 'weeklyXP', COALESCE(p_weekly,'[0,0,0,0,0,0,0]'::jsonb),
    'dailyGoal', p_daily_goal, 'freezes', p_freezes, 'lastFreezeGrant', p_lfg
  ) WHERE id = p_child_id;

  v_new := v_cur + 1;
  UPDATE sync_state SET data_version = v_new, updated_at = clock_timestamp() WHERE scope_id = p_child_id;
  RETURN jsonb_build_object('ok', true, 'version', v_new, 'updated_at', clock_timestamp());
END; $function$;

REVOKE ALL ON FUNCTION public.load_child_data(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_child_data(uuid, text, jsonb, jsonb, jsonb, integer, integer, integer, integer, jsonb, integer, integer, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.load_child_data(uuid, text) TO anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_child_data(uuid, text, jsonb, jsonb, jsonb, integer, integer, integer, integer, jsonb, integer, integer, bigint, bigint) TO anonymous, authenticated;

COMMIT;

-- PFLICHTSCHRITT NACH DEM LAUF: Schema-Cache der Data API neu laden. Neons Data
-- API cacht Funktionssignaturen; ohne Refresh antwortet sie auf den neuen Aufruf
-- mit 404 „Could not find the function public.sync_my_data(p_base_version, …)“
-- (verifiziert auf dem Dev-Branch — NOTIFY pgrst, 'reload schema' wirkt NICHT).
-- Wege: Neon-Konsole → Postgres database → Data API → „Refresh schema cache“,
-- oder Neon-MCP `update_data_api` (ohne Einstellungen), oder
-- PATCH /api/v2/projects/{project}/branches/{branch}/data-api/{db} mit Body {}.

-- Verifikation ----------------------------------------------------------------------
-- a) alle SECURITY-DEFINER-Funktionen weiterhin mit festgenageltem search_path (muss 0 liefern):
-- SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.prosecdef
--    AND (p.proconfig IS NULL OR NOT ('search_path=public, pg_temp' = ANY(p.proconfig)));
-- b) Signaturen/ACL:
-- SELECT has_function_privilege('authenticated','public.sync_my_data(jsonb,jsonb,jsonb,bigint)','EXECUTE'),  -- true
--        has_function_privilege('anonymous','public.sync_my_data(jsonb,jsonb,jsonb,bigint)','EXECUTE'),      -- false
--        has_function_privilege('anonymous','public.sync_child_data(uuid,text,jsonb,jsonb,jsonb,integer,integer,integer,integer,jsonb,integer,integer,bigint,bigint)','EXECUTE'), -- true
--        has_table_privilege('authenticated','public.sync_state','SELECT');                                   -- false
-- c) Verhalten (tests/db/sync-conflict.test.mjs über die Data API, tests/db/structure.test.mjs per SQL):
--    ohne p_base_version → PT428; veraltete Version → PT409, Zeilen unverändert;
--    Szenario A: 50 Karten (v1) + 1 Karte mit Basis v0 → PT409 → Merge → 51 Karten (v2).
