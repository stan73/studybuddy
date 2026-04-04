/**
 * StudyBuddy Pro — Globaler App-State
 * Zentrales State-Management ohne Framework.
 * Alle Teile der App importieren hieraus.
 */

import { storeGet, storeSave, getApiKey } from './utils/storage.js';

// ── Initialer State ──────────────────────────────────────────────────────────

const defaultData = {
  cards: {},      // { [subject]: [{front, back, level, due_at}] }
  tasks: [],      // [{id, title, subject, due_at, completed}]
  exams: [],      // [{id, subject, score, total, date}]
  sessions: [],   // [{subject, type, duration, xp, date}]
  xp: 0,
  streak: 0,
  lastStudy: 0,
  correct: 0,
  total: 0,
};

// Reaktiver State-Container
class AppState {
  constructor() {
    this._user = null;      // Supabase User-Objekt + Profil
    this._data = { ...defaultData };
    this._listeners = new Map();
    this._currentPage = 'dashboard';
    this._initialized = false;
  }

  // ── User ────────────────────────────────────────
  get user() { return this._user; }
  set user(val) {
    this._user = val;
    this._emit('user', val);
  }

  get isLoggedIn() { return !!this._user; }

  get isStudent() { return this._user?.role === 'student'; }
  get isParent()  { return this._user?.role === 'parent'; }
  get isTeacher() { return this._user?.role === 'teacher'; }

  // ── Learning Data ───────────────────────────────
  get data() { return this._data; }

  updateData(patch) {
    this._data = { ...this._data, ...patch };
    this._persist();
    this._emit('data', this._data);
  }

  // ── Page Routing ────────────────────────────────
  get currentPage() { return this._currentPage; }
  set currentPage(page) {
    this._currentPage = page;
    this._emit('page', page);
  }

  // ── Persistence ─────────────────────────────────
  load() {
    const saved = storeGet('data');
    if (saved) {
      this._data = { ...defaultData, ...saved };
    }
    this._initialized = true;
  }

  _persist() {
    // Sensible Daten NICHT speichern (API Key ist in memory store)
    const { ...toSave } = this._data;
    storeSave('data', toSave);
  }

  reset() {
    this._data = { ...defaultData };
    this._persist();
    this._emit('data', this._data);
  }

  // ── Event System (reaktiv) ──────────────────────
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    return () => this._listeners.get(event)?.delete(callback); // unsubscribe
  }

  _emit(event, data) {
    this._listeners.get(event)?.forEach(cb => {
      try { cb(data); } catch (e) { console.error('[State] Listener error:', e); }
    });
  }

  // ── XP & Streak Helpers ─────────────────────────
  addXP(amount) {
    this.updateData({ xp: (this._data.xp || 0) + amount });
  }

  updateStreak() {
    const now = Date.now();
    const last = this._data.lastStudy || 0;
    const diffHours = (now - last) / (1000 * 60 * 60);

    let streak = this._data.streak || 0;
    if (diffHours <= 26) {
      // Innerhalb von 26 Stunden → Streak erhöhen
      streak += 1;
    } else if (diffHours > 48) {
      // Mehr als 48 Stunden → Streak zurücksetzen
      streak = 1;
    }
    // Zwischen 26-48h: Streak erhalten

    this.updateData({ streak, lastStudy: now });
    return streak;
  }
}

// Singleton Export
export const state = new AppState();
