/**
 * StudyBuddy Pro — Authentication
 *
 * Phase 2: Supabase Auth (echte Nutzerkonten).
 * Fallback: Demo-Modus wenn Supabase nicht konfiguriert.
 *
 * CRA-Anforderung: Sichere Authentifizierung, keine Default-Passwörter,
 * Passwort-Stärke-Validierung, Session-Management.
 */

import { CONFIG } from './config.js';
import { state } from './state.js';
import { validateEmail, validatePassword, sanitizeText } from './utils/sanitize.js';
import { storeSave, storeGet, storeRemove, storeClear, setApiKey } from './utils/storage.js';

// Prüft ob Supabase konfiguriert ist
const SUPABASE_READY = (
  CONFIG.SUPABASE_URL !== 'https://DEIN_PROJEKT.supabase.co' &&
  CONFIG.SUPABASE_ANON_KEY !== 'DEIN_ANON_KEY'
);

// Supabase Client (wird erst bei Bedarf initialisiert)
let supabase = null;

function getSupabase() {
  if (!SUPABASE_READY) return null;
  if (supabase) return supabase;
  if (typeof window.supabase === 'undefined') return null;
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return supabase;
}

// ── Demo-Modus ───────────────────────────────────────────────────────────────
// Wenn Supabase nicht konfiguriert: Demo mit localStorage

function createDemoUser(email, role = 'student') {
  return {
    id: 'demo_' + Date.now(),
    email,
    full_name: role === 'parent' ? 'Demo Elternteil' : role === 'teacher' ? 'Demo Lehrer' : 'Demo Schüler',
    role,
    grade: 9,
    school: 'Gymnasium',
    subscription: 'free',
    children: role === 'parent' ? [
      { id: 'child_1', name: 'Max Müller', grade: 7 },
      { id: 'child_2', name: 'Lisa Müller', grade: 5 },
    ] : [],
    isDemo: true,
  };
}

// ── Auth Functions ────────────────────────────────────────────────────────────

/**
 * Einloggen.
 * @param {string} email
 * @param {string} password
 * @returns {{ user: object|null, error: string|null }}
 */
export async function signIn(email, password) {
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) return { user: null, error: 'Ungültige E-Mail-Adresse' };
  if (!password) return { user: null, error: 'Passwort erforderlich' };

  const sb = getSupabase();

  // Demo-Modus
  if (!sb) {
    const user = createDemoUser(emailCheck.value);
    state.user = user;
    storeSave('session', { user, demo: true });
    return { user, error: null };
  }

  // Supabase Auth
  const { data, error } = await sb.auth.signInWithPassword({
    email: emailCheck.value,
    password,
  });

  if (error) return { user: null, error: _translateError(error.message) };

  // Profil laden
  const profile = await loadProfile(data.user.id);
  const user = { ...data.user, ...profile };
  state.user = user;
  return { user, error: null };
}

/**
 * Registrieren.
 * @param {object} params - { email, password, full_name, role, grade, school, children }
 * @returns {{ user: object|null, error: string|null }}
 */
export async function signUp({ email, password, full_name, role, grade, school, children = [] }) {
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) return { user: null, error: 'Ungültige E-Mail-Adresse' };

  const pwCheck = validatePassword(password);
  if (!pwCheck.valid) return { user: null, error: pwCheck.message };

  const name = sanitizeText(full_name, 100);
  if (!name) return { user: null, error: 'Name erforderlich' };

  const sb = getSupabase();

  // Demo-Modus
  if (!sb) {
    const user = createDemoUser(emailCheck.value, role);
    user.full_name = name;
    user.grade = grade;
    user.school = school;
    user.children = children;
    state.user = user;
    storeSave('session', { user, demo: true });
    return { user, error: null };
  }

  // Supabase Auth
  const { data, error } = await sb.auth.signUp({
    email: emailCheck.value,
    password,
    options: {
      data: { full_name: name, role, grade, school },
    },
  });

  if (error) return { user: null, error: _translateError(error.message) };

  // Profil anlegen
  const { error: profileError } = await sb.from('profiles').insert({
    id: data.user.id,
    email: emailCheck.value,
    full_name: name,
    role,
    grade: role === 'student' ? Number(grade) : null,
    school: sanitizeText(school || '', 100),
    subscription: 'free',
  });

  if (profileError) console.error('[Auth] Profil-Fehler:', profileError);

  // Kinder anlegen (für Eltern)
  if (role === 'parent' && children.length > 0) {
    const childRecords = children.map(c => ({
      parent_id: data.user.id,
      name: sanitizeText(c.name, 80),
      grade: Number(c.grade),
    }));
    await sb.from('children').insert(childRecords);
  }

  const user = { ...data.user, full_name: name, role, grade, school };
  state.user = user;
  return { user, error: null };
}

/**
 * Ausloggen.
 */
export async function signOut() {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
  state.user = null;
  storeRemove('session');
  storeClear();
}

/**
 * Aktuelle Session laden (App-Start).
 * @returns {object|null} User oder null
 */
export async function getSession() {
  const sb = getSupabase();

  // Demo-Modus: Session aus localStorage
  if (!sb) {
    const saved = storeGet('session');
    if (saved?.user) {
      state.user = saved.user;
      return saved.user;
    }
    return null;
  }

  // Supabase Session
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;

  const profile = await loadProfile(session.user.id);
  const user = { ...session.user, ...profile };
  state.user = user;
  return user;
}

/**
 * Auth-State-Listener (für reaktive Updates).
 * @param {function} callback
 */
export function onAuthChange(callback) {
  const sb = getSupabase();
  if (!sb) return () => {};
  const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null);
  });
  return () => subscription.unsubscribe();
}

/**
 * Profil eines Users laden.
 * @param {string} userId
 * @returns {object}
 */
async function loadProfile(userId) {
  const sb = getSupabase();
  if (!sb) return {};

  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('[Auth] Profil laden fehlgeschlagen:', error);
    return {};
  }
  return data || {};
}

/**
 * Übersetzt englische Supabase-Fehlermeldungen ins Deutsche.
 */
function _translateError(msg = '') {
  if (msg.includes('Invalid login')) return 'E-Mail oder Passwort falsch';
  if (msg.includes('Email not confirmed')) return 'E-Mail noch nicht bestätigt — bitte E-Mail prüfen';
  if (msg.includes('User already registered')) return 'Diese E-Mail ist bereits registriert';
  if (msg.includes('rate limit')) return 'Zu viele Versuche — bitte kurz warten';
  if (msg.includes('network')) return 'Netzwerkfehler — bitte Internet prüfen';
  return 'Fehler: ' + msg;
}

export { SUPABASE_READY };
