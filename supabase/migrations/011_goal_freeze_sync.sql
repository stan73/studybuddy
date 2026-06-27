-- Migration 011: Tagesziel + Streak-Freeze geräteübergreifend syncen (P1.1)
-- Bisher nur lokal. Jetzt: daily_goal/freezes/last_freeze_grant in user_stats
-- (Eltern/Schüler) und in children.stats (Kinder, via erweiterter RPC).
-- last_freeze_grant als BIGINT (ms-Timestamp) für konsistente Repräsentation.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS daily_goal        INT    NOT NULL DEFAULT 5 CHECK (daily_goal BETWEEN 1 AND 50);
ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS freezes           INT    NOT NULL DEFAULT 0 CHECK (freezes >= 0);
ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS last_freeze_grant BIGINT;

-- sync_child_data um dailyGoal/freezes/lastFreezeGrant erweitern (Signaturänderung → DROP+CREATE)
DROP FUNCTION IF EXISTS sync_child_data(uuid, text, jsonb, jsonb, jsonb, int, int, int, int, jsonb);

CREATE OR REPLACE FUNCTION sync_child_data(
  p_child_id UUID, p_pin TEXT,
  p_cards JSONB DEFAULT '[]'::jsonb,
  p_tasks JSONB DEFAULT '[]'::jsonb,
  p_exams JSONB DEFAULT '[]'::jsonb,
  p_xp INT DEFAULT 0, p_streak INT DEFAULT 0,
  p_correct INT DEFAULT 0, p_total INT DEFAULT 0,
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
  INSERT INTO cards (id, user_id, child_id, subject, front, back, level, due_at, ease, reps, interval_days)
    SELECT COALESCE(NULLIF(c->>'id','')::uuid, gen_random_uuid()),
           v_parent, p_child_id, c->>'subject', c->>'front', c->>'back',
           COALESCE((c->>'level')::int, 0),
           COALESCE((c->>'due_at')::timestamptz, NOW()),
           COALESCE((c->>'ease')::numeric, 2.5),
           COALESCE((c->>'reps')::int, 0),
           COALESCE((c->>'interval_days')::int, 0)
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
    'lastStudy', NOW(), 'weeklyXP', COALESCE(p_weekly,'[0,0,0,0,0,0,0]'::jsonb),
    'dailyGoal', p_daily_goal, 'freezes', p_freezes, 'lastFreezeGrant', p_lfg
  ) WHERE id = p_child_id;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION sync_child_data(uuid, text, jsonb, jsonb, jsonb, int, int, int, int, jsonb, int, int, bigint) TO anon;
