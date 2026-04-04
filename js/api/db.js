/**
 * StudyBuddy Pro — Datenbank-Layer (Supabase)
 * Alle CRUD-Operationen an einem Ort.
 * Fallback auf localStorage wenn Supabase nicht konfiguriert.
 */

import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { SUPABASE_READY } from '../auth.js';

function sb() {
  return SUPABASE_READY && window.supabase
    ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
    : null;
}

// ── Karteikarten ──────────────────────────────────────────────────────────────

export async function getCards(subject) {
  const client = sb();
  if (!client) {
    return state.data.cards?.[subject] || [];
  }
  const { data, error } = await client
    .from('cards')
    .select('*')
    .eq('user_id', state.user.id)
    .eq('subject', subject)
    .order('due_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addCard({ subject, front, back }) {
  const card = { subject, front, back, level: 0, due_at: new Date().toISOString() };
  const client = sb();

  if (!client) {
    const cards = { ...state.data.cards };
    if (!cards[subject]) cards[subject] = [];
    cards[subject].push({ ...card, id: crypto.randomUUID() });
    state.updateData({ cards });
    return;
  }

  const { error } = await client.from('cards').insert({
    ...card,
    user_id: state.user.id,
  });
  if (error) throw error;
}

export async function updateCard(id, patch) {
  const client = sb();
  if (!client) {
    // localStorage Update
    const cards = { ...state.data.cards };
    for (const subj in cards) {
      const idx = cards[subj].findIndex(c => c.id === id);
      if (idx !== -1) {
        cards[subj][idx] = { ...cards[subj][idx], ...patch };
        break;
      }
    }
    state.updateData({ cards });
    return;
  }
  const { error } = await client.from('cards').update(patch).eq('id', id).eq('user_id', state.user.id);
  if (error) throw error;
}

export async function deleteCard(id) {
  const client = sb();
  if (!client) {
    const cards = { ...state.data.cards };
    for (const subj in cards) {
      cards[subj] = cards[subj].filter(c => c.id !== id);
    }
    state.updateData({ cards });
    return;
  }
  const { error } = await client.from('cards').delete().eq('id', id).eq('user_id', state.user.id);
  if (error) throw error;
}

// ── Lernsessions ───────────────────────────────────────────────────────────────

export async function addSession({ subject, type, duration, xp }) {
  const session = { subject, session_type: type, duration_minutes: duration, xp_earned: xp };
  const client = sb();

  if (!client) {
    const sessions = [...(state.data.sessions || [])];
    sessions.push({ ...session, id: crypto.randomUUID(), created_at: new Date().toISOString() });
    state.updateData({ sessions });
    return;
  }
  const { error } = await client.from('sessions').insert({ ...session, user_id: state.user.id });
  if (error) throw error;
}

export async function getSessions(userId, days = 7) {
  const client = sb();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  if (!client) {
    return (state.data.sessions || [])
      .filter(s => new Date(s.created_at) > new Date(since))
      .slice(-50);
  }

  const { data, error } = await client
    .from('sessions')
    .select('*')
    .eq('user_id', userId || state.user.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ── Aufgaben ──────────────────────────────────────────────────────────────────

export async function getTasks() {
  const client = sb();
  if (!client) return state.data.tasks || [];
  const { data, error } = await client
    .from('tasks')
    .select('*')
    .eq('user_id', state.user.id)
    .order('due_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addTask({ title, subject, due_at }) {
  const task = { title, subject, due_at, completed: false };
  const client = sb();
  if (!client) {
    const tasks = [...(state.data.tasks || [])];
    tasks.push({ ...task, id: crypto.randomUUID(), created_at: new Date().toISOString() });
    state.updateData({ tasks });
    return;
  }
  const { error } = await client.from('tasks').insert({ ...task, user_id: state.user.id });
  if (error) throw error;
}

export async function toggleTask(id, completed) {
  const client = sb();
  if (!client) {
    const tasks = (state.data.tasks || []).map(t => t.id === id ? { ...t, completed } : t);
    state.updateData({ tasks });
    return;
  }
  const { error } = await client.from('tasks').update({ completed }).eq('id', id).eq('user_id', state.user.id);
  if (error) throw error;
}

// ── Prüfungen ─────────────────────────────────────────────────────────────────

export async function addExam({ subject, score, total }) {
  const exam = { subject, score, total, created_at: new Date().toISOString() };
  const client = sb();
  if (!client) {
    const exams = [...(state.data.exams || [])];
    exams.push({ ...exam, id: crypto.randomUUID() });
    state.updateData({ exams });
    return;
  }
  const { error } = await client.from('exams').insert({ ...exam, user_id: state.user.id });
  if (error) throw error;
}

// ── User Stats ────────────────────────────────────────────────────────────────

export async function getStats(userId) {
  const client = sb();
  if (!client) {
    return {
      xp: state.data.xp || 0,
      streak: state.data.streak || 0,
      correct: state.data.correct || 0,
      total: state.data.total || 0,
    };
  }
  const { data } = await client
    .from('user_stats')
    .select('*')
    .eq('user_id', userId || state.user.id)
    .single();
  return data || {};
}

export async function updateStats(patch) {
  const client = sb();
  if (!client) {
    state.updateData(patch);
    return;
  }
  const { error } = await client
    .from('user_stats')
    .upsert({ user_id: state.user.id, ...patch });
  if (error) throw error;
}

// ── Kinder (für Eltern) ───────────────────────────────────────────────────────

export async function getChildren(parentId) {
  const client = sb();
  if (!client) return state.user?.children || [];
  const { data, error } = await client
    .from('children')
    .select('*, profiles(*)')
    .eq('parent_id', parentId || state.user.id);
  if (error) throw error;
  return data || [];
}
