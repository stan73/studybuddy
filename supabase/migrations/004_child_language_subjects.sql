-- Migration 004: Per-child language, school URL, custom subjects, subject management permission
-- Run in Supabase Dashboard → SQL Editor

-- 1. Neue Spalten zur children Tabelle hinzufügen
ALTER TABLE children ADD COLUMN IF NOT EXISTS language         text    DEFAULT 'de';
ALTER TABLE children ADD COLUMN IF NOT EXISTS school_url       text;
ALTER TABLE children ADD COLUMN IF NOT EXISTS subjects         jsonb;
ALTER TABLE children ADD COLUMN IF NOT EXISTS can_manage_subjects boolean DEFAULT false;

-- 2. auth_child RPC aktualisieren — gibt jetzt auch language, school_url, subjects, can_manage_subjects zurück
CREATE OR REPLACE FUNCTION auth_child(p_parent_email TEXT, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_parent_id UUID;
  v_child children%ROWTYPE;
BEGIN
  p_parent_email := lower(trim(p_parent_email));
  p_pin := trim(p_pin);

  SELECT id INTO v_parent_id FROM profiles WHERE lower(email) = p_parent_email LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Elternteil nicht gefunden');
  END IF;

  SELECT * INTO v_child FROM children
    WHERE parent_id = v_parent_id AND pin = p_pin LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'PIN ungültig — bitte Elternteil fragen');
  END IF;

  RETURN json_build_object(
    'child_id',             v_child.id,
    'child_name',           v_child.name,
    'grade',                v_child.grade,
    'parent_email',         p_parent_email,
    'language',             COALESCE(v_child.language, 'de'),
    'school_url',           v_child.school_url,
    'subjects',             v_child.subjects,
    'can_manage_subjects',  COALESCE(v_child.can_manage_subjects, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION auth_child(TEXT, TEXT) TO anon;
