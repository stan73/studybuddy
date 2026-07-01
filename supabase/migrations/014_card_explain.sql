-- Migration 014: Erklärendes Feedback — kurze Begründung/Merkhilfe je Karte (cards.explain)
-- Lernwissenschaft (Shute 2008): elaboriertes Feedback ("warum") schlägt reines Richtig/Falsch.
-- Wird bei falscher Antwort (und optional immer auf der Rückseite) angezeigt. KI füllt es bei
-- der Kartenerstellung; on-demand nachgenerierbar. RPCs tragen explain im cards-JSONB.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE cards ADD COLUMN IF NOT EXISTS explain TEXT CHECK (explain IS NULL OR char_length(explain) <= 400);

CREATE OR REPLACE FUNCTION sync_my_data(
  p_cards JSONB DEFAULT '[]'::jsonb, p_tasks JSONB DEFAULT '[]'::jsonb, p_exams JSONB DEFAULT '[]'::jsonb
) RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
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
END; $$;
GRANT EXECUTE ON FUNCTION sync_my_data TO authenticated;

CREATE OR REPLACE FUNCTION load_my_data()
RETURNS JSON LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
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
END; $$;
GRANT EXECUTE ON FUNCTION load_my_data TO authenticated;

CREATE OR REPLACE FUNCTION sync_child_data(
  p_child_id UUID, p_pin TEXT,
  p_cards JSONB DEFAULT '[]'::jsonb, p_tasks JSONB DEFAULT '[]'::jsonb, p_exams JSONB DEFAULT '[]'::jsonb,
  p_xp INT DEFAULT 0, p_streak INT DEFAULT 0, p_correct INT DEFAULT 0, p_total INT DEFAULT 0,
  p_weekly JSONB DEFAULT '[0,0,0,0,0,0,0]'::jsonb,
  p_daily_goal INT DEFAULT 5, p_freezes INT DEFAULT 0, p_lfg BIGINT DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_parent UUID;
BEGIN
  SELECT parent_id INTO v_parent FROM children WHERE id = p_child_id AND pin = p_pin;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM cards WHERE child_id = p_child_id;
  DELETE FROM tasks WHERE child_id = p_child_id;
  DELETE FROM exams WHERE child_id = p_child_id;
  INSERT INTO cards (id, user_id, child_id, subject, front, back, level, due_at, ease, reps, interval_days, topic, exam_name, exam_date, explain)
    SELECT COALESCE(NULLIF(c->>'id','')::uuid, gen_random_uuid()),
           v_parent, p_child_id, c->>'subject', c->>'front', c->>'back',
           COALESCE((c->>'level')::int, 0), COALESCE((c->>'due_at')::timestamptz, NOW()),
           COALESCE((c->>'ease')::numeric, 2.5), COALESCE((c->>'reps')::int, 0),
           COALESCE((c->>'interval_days')::int, 0), NULLIF(c->>'topic',''),
           NULLIF(c->>'exam_name',''), NULLIF(c->>'exam_date','')::date, NULLIF(c->>'explain','')
    FROM jsonb_array_elements(COALESCE(p_cards,'[]'::jsonb)) c;
  INSERT INTO tasks (id, user_id, child_id, title, subject, due_at, completed)
    SELECT COALESCE(NULLIF(t->>'id','')::uuid, gen_random_uuid()),
           v_parent, p_child_id, t->>'title', NULLIF(t->>'subject',''), NULLIF(t->>'due_at','')::date,
           COALESCE((t->>'completed')::boolean, false)
    FROM jsonb_array_elements(COALESCE(p_tasks,'[]'::jsonb)) t;
  INSERT INTO exams (id, user_id, child_id, subject, score, total, created_at)
    SELECT COALESCE(NULLIF(e->>'id','')::uuid, gen_random_uuid()),
           v_parent, p_child_id, e->>'subject', (e->>'score')::int, (e->>'total')::int,
           COALESCE((e->>'created_at')::timestamptz, NOW())
    FROM jsonb_array_elements(COALESCE(p_exams,'[]'::jsonb)) e;
  UPDATE children SET stats = jsonb_build_object(
    'xp', p_xp, 'streak', p_streak, 'correct', p_correct, 'total', p_total,
    'lastStudy', NOW(), 'weeklyXP', COALESCE(p_weekly,'[0,0,0,0,0,0,0]'::jsonb),
    'dailyGoal', p_daily_goal, 'freezes', p_freezes, 'lastFreezeGrant', p_lfg
  ) WHERE id = p_child_id;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION sync_child_data(uuid, text, jsonb, jsonb, jsonb, int, int, int, int, jsonb, int, int, bigint) TO anon;

CREATE OR REPLACE FUNCTION load_child_data(p_child_id UUID, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok UUID;
BEGIN
  SELECT id INTO v_ok FROM children WHERE id = p_child_id AND pin = p_pin;
  IF NOT FOUND THEN RETURN json_build_object('error', 'pin'); END IF;
  RETURN json_build_object(
    'cards', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, front, back, level, due_at, ease, reps, interval_days, topic, exam_name, exam_date, explain FROM cards WHERE child_id = p_child_id) x), '[]'::json),
    'tasks', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, title, subject, due_at, completed FROM tasks WHERE child_id = p_child_id) x), '[]'::json),
    'exams', COALESCE((SELECT json_agg(row_to_json(x)) FROM
      (SELECT id, subject, score, total, created_at FROM exams WHERE child_id = p_child_id) x), '[]'::json),
    'stats', (SELECT stats FROM children WHERE id = p_child_id)
  );
END; $$;
GRANT EXECUTE ON FUNCTION load_child_data TO anon;
