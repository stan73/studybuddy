-- StudyBuddy Pro — Supabase Datenbankschema
-- Version 2.0 | CRA-konform mit Row Level Security (RLS)
--
-- AUSFÜHREN: Supabase Dashboard → SQL Editor → Diesen Code einfügen → Run
-- ─────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════
-- TABELLEN
-- ══════════════════════════════════════════════════════════════════

-- Nutzerprofile (erweitert Supabase Auth)
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  full_name   TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 100),
  role        TEXT NOT NULL CHECK (role IN ('student', 'parent', 'teacher')),
  grade       INTEGER CHECK (grade IS NULL OR grade BETWEEN 5 AND 13),
  school      TEXT CHECK (school IS NULL OR char_length(school) <= 100),
  subscription TEXT NOT NULL DEFAULT 'free' CHECK (subscription IN ('free','family_plus','family_pro','teacher')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE profiles IS 'Nutzerprofile mit Rolle und Schulinformationen';
COMMENT ON COLUMN profiles.id IS 'Entspricht auth.users.id — kein separater Primary Key nötig';

-- Kinder (für Eltern-Accounts)
CREATE TABLE IF NOT EXISTS children (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  grade       INTEGER NOT NULL CHECK (grade BETWEEN 5 AND 13),
  school      TEXT CHECK (school IS NULL OR char_length(school) <= 100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE children IS 'Kinder-Profile unter einem Eltern-Account';

-- Karteikarten
CREATE TABLE IF NOT EXISTS cards (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 80),
  front       TEXT NOT NULL CHECK (char_length(front) BETWEEN 1 AND 1000),
  back        TEXT NOT NULL CHECK (char_length(back) BETWEEN 1 AND 1000),
  level       INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 4),
  due_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE cards IS 'Karteikarten mit Spaced-Repetition Level (0-4)';
CREATE INDEX IF NOT EXISTS cards_user_subject_due ON cards(user_id, subject, due_at);

-- Lernsessions
CREATE TABLE IF NOT EXISTS sessions (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject          TEXT CHECK (char_length(subject) <= 80),
  session_type     TEXT CHECK (session_type IN ('flashcard','exam','tutor','pomodoro')),
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 480),
  xp_earned        INTEGER NOT NULL DEFAULT 0 CHECK (xp_earned >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE sessions IS 'Aufzeichnung jeder Lerneinheit für Fortschritts-Tracking';
CREATE INDEX IF NOT EXISTS sessions_user_created ON sessions(user_id, created_at DESC);

-- Prüfungsergebnisse
CREATE TABLE IF NOT EXISTS exams (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 80),
  score       INTEGER NOT NULL CHECK (score >= 0),
  total       INTEGER NOT NULL CHECK (total > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_score CHECK (score <= total)
);
COMMENT ON TABLE exams IS 'Prüfungsergebnisse des Prüfungsmodus';

-- Aufgaben / To-Dos
CREATE TABLE IF NOT EXISTS tasks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  subject     TEXT CHECK (char_length(subject) <= 80),
  due_at      DATE,
  completed   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE tasks IS 'Lernaufgaben und Hausaufgaben-Tracking';

-- User-Statistiken (denormalisiert für Performance)
CREATE TABLE IF NOT EXISTS user_stats (
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE PRIMARY KEY,
  xp            INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  streak        INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  last_study_at TIMESTAMPTZ,
  total_correct INTEGER NOT NULL DEFAULT 0 CHECK (total_correct >= 0),
  total_answered INTEGER NOT NULL DEFAULT 0 CHECK (total_answered >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) — CRA-Anforderung
-- Jeder Nutzer sieht und verändert NUR seine eigenen Daten.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE children   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;

-- profiles: Nur eigenes Profil lesen/schreiben
CREATE POLICY "profiles_own" ON profiles FOR ALL USING (auth.uid() = id);

-- children: Nur eigene Kinder
CREATE POLICY "children_own" ON children FOR ALL USING (auth.uid() = parent_id);

-- cards: Nur eigene Karten
CREATE POLICY "cards_own" ON cards FOR ALL USING (auth.uid() = user_id);

-- sessions: Nutzer sieht eigene Sessions; Eltern sehen Sessions ihrer Kinder
CREATE POLICY "sessions_own" ON sessions FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.uid() IN (
      SELECT parent_id FROM children WHERE id = user_id
    )
  );
CREATE POLICY "sessions_insert" ON sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_delete" ON sessions FOR DELETE USING (auth.uid() = user_id);

-- exams: Nur eigene Prüfungen
CREATE POLICY "exams_own" ON exams FOR ALL USING (auth.uid() = user_id);

-- tasks: Nur eigene Aufgaben
CREATE POLICY "tasks_own" ON tasks FOR ALL USING (auth.uid() = user_id);

-- user_stats: Nur eigene Stats; Eltern dürfen Kinder-Stats lesen
CREATE POLICY "stats_own_write" ON user_stats FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "stats_parent_read" ON user_stats FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.uid() IN (
      SELECT parent_id FROM children WHERE id = user_id
    )
  );

-- ══════════════════════════════════════════════════════════════════
-- TRIGGER: updated_at automatisch setzen
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER stats_updated_at
  BEFORE UPDATE ON user_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════════════════════════════
-- TRIGGER: Profil automatisch bei Auth-Registrierung anlegen
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO user_stats (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
