/**
 * StudyBuddy Pro — App-Konfiguration
 * Zentrale Stelle für alle Konstanten und Einstellungen.
 *
 * WICHTIG: Supabase-Credentials hier eintragen nach Projekterstellung.
 * Nie sensible Secrets (Service Role Key, DB-Passwort) hier speichern —
 * nur den öffentlichen "anon" Key.
 */

export const CONFIG = {
  // ── Supabase ────────────────────────────────────
  SUPABASE_URL: 'https://qzmviwrpyfpjahcmbjoy.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6bXZpd3JweWZwamFoY21iam95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyOTg5NTcsImV4cCI6MjA5MDg3NDk1N30.BT2iRuWdI33yigziU3kicb-GQT14IHe3WU8JxFlQG0M',

  // ── Claude API ──────────────────────────────────
  // Modell: Haiku ist am günstigsten (ca. 80% günstiger als Sonnet)
  CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
  CLAUDE_API_URL: 'https://api.anthropic.com/v1/messages',

  // Budget-Schutz: Maximale Token pro Request
  CLAUDE_MAX_TOKENS_CARDS: 1200,   // Karteikarten generieren
  CLAUDE_MAX_TOKENS_TUTOR: 400,    // KI-Tutor Antworten (kurz halten!)
  CLAUDE_MAX_TOKENS_EXAM: 2000,    // Prüfungsfragen

  // Rate-Limiting (Anfragen pro Minute)
  CLAUDE_RATE_LIMIT: 3,

  // Cache-Dauer für AI-Antworten (Sekunden)
  CLAUDE_CACHE_TTL: 900, // 15 Minuten

  // ── App-Konfiguration ────────────────────────────
  APP_NAME: 'StudyBuddy Pro',
  APP_VERSION: '2.0.0',

  // Klassen
  GRADES: [5, 6, 7, 8, 9, 10, 11, 12, 13],

  // Schulformen
  SCHOOL_TYPES: ['Gymnasium', 'Realschule', 'Gesamtschule', 'Hauptschule', 'Berufsschule'],

  // Fächer pro Klasse
  SUBJECTS: {
    5:  ['Mathematik','Deutsch','Englisch','Biologie','Geschichte','Geografie','Kunst','Sport','Musik'],
    6:  ['Mathematik','Deutsch','Englisch','Biologie','Geschichte','Geografie','Kunst','Sport','Musik','Latein'],
    7:  ['Mathematik','Deutsch','Englisch','Biologie','Chemie','Geschichte','Geografie','Physik','Latein','Französisch'],
    8:  ['Mathematik','Deutsch','Englisch','Biologie','Chemie','Geschichte','Geografie','Physik','Latein','Französisch'],
    9:  ['Mathematik','Deutsch','Englisch','Biologie','Chemie','Geschichte','Geografie','Physik','Latein','Französisch','Informatik'],
    10: ['Mathematik','Deutsch','Englisch','Biologie','Chemie','Geschichte','Geografie','Physik','Informatik','Wirtschaft'],
    11: ['Mathematik','Deutsch','Englisch','Biologie','Chemie','Geschichte','Physik','Informatik','Wirtschaft','Philosophie'],
    12: ['Mathematik','Deutsch','Englisch','Biologie','Chemie','Geschichte','Physik','Informatik','Wirtschaft','Philosophie'],
    13: ['Mathematik','Deutsch','Englisch','Biologie','Chemie','Geschichte','Physik','Informatik','Wirtschaft','Philosophie'],
  },

  // Fach-Emojis und Farben
  SUBJECT_META: {
    'Mathematik':  { emoji: '📐', color: '#6366f1' },
    'Deutsch':     { emoji: '📖', color: '#8b5cf6' },
    'Englisch':    { emoji: '🇬🇧', color: '#3b82f6' },
    'Biologie':    { emoji: '🌿', color: '#10b981' },
    'Chemie':      { emoji: '⚗️', color: '#f59e0b' },
    'Physik':      { emoji: '⚡', color: '#f97316' },
    'Geschichte':  { emoji: '🏛️', color: '#ef4444' },
    'Geografie':   { emoji: '🌍', color: '#06b6d4' },
    'Informatik':  { emoji: '💻', color: '#6366f1' },
    'Latein':      { emoji: '🏺', color: '#a78bfa' },
    'Französisch': { emoji: '🥐', color: '#ec4899' },
    'Kunst':       { emoji: '🎨', color: '#f43f5e' },
    'Musik':       { emoji: '🎵', color: '#8b5cf6' },
    'Sport':       { emoji: '⚽', color: '#10b981' },
    'Wirtschaft':  { emoji: '📊', color: '#0ea5e9' },
    'Philosophie': { emoji: '🤔', color: '#7c3aed' },
    'default':     { emoji: '📚', color: '#6366f1' },
  },

  // ── Abonnements ──────────────────────────────────
  PLANS: {
    free: {
      name: 'Starter',
      price: 0,
      features: ['1 Schüler', 'Grundfunktionen', '10 KI-Karten/Monat'],
    },
    family_plus: {
      name: 'Family Plus',
      price: 9.99,
      features: ['Bis 3 Kinder', 'Eltern-Dashboard', '100 KI-Karten/Monat', 'Lernberichte'],
    },
    family_pro: {
      name: 'Family Pro',
      price: 14.99,
      features: ['Bis 6 Kinder', 'Alle Features', 'Unbegrenzte KI-Karten', 'Priority Support'],
    },
    teacher: {
      name: 'Teacher',
      price: 6.99,
      features: ['30 Schüler', 'Materialien hochladen', 'Klassen-Dashboard', 'Berichte'],
    },
  },

  // ── Spaced Repetition ────────────────────────────
  // Tage bis zur nächsten Wiederholung je Level (0-4)
  SR_INTERVALS: [1, 3, 7, 14, 30],

  // ── XP-System ────────────────────────────────────
  XP: {
    CARD_CORRECT: 10,
    CARD_WRONG: 2,
    EXAM_COMPLETE: 50,
    TUTOR_MESSAGE: 5,
    POMODORO_COMPLETE: 30,
    STREAK_BONUS: 20,
  },
};
