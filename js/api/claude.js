/**
 * StudyBuddy Pro — Claude API Wrapper
 *
 * Budget-bewusst:
 * - Nur claude-haiku (günstigstes Modell)
 * - Response-Caching (15 Min, sessionStorage)
 * - Rate-Limiting (max. 3 Req/Min)
 * - Minimale Token-Limits
 * - Kurze, optimierte Prompts
 */

import { CONFIG } from '../config.js';
import { getApiKey } from '../utils/storage.js';

// ── Rate Limiter ──────────────────────────────────────────────────────────────
const _queue = [];
let _reqCount = 0;
let _resetTimer = null;

function _checkRateLimit() {
  if (_reqCount >= CONFIG.CLAUDE_RATE_LIMIT) {
    throw new Error(`Zu viele KI-Anfragen. Bitte ${Math.ceil(60 / CONFIG.CLAUDE_RATE_LIMIT)} Sekunden warten.`);
  }
  _reqCount++;
  if (!_resetTimer) {
    _resetTimer = setTimeout(() => {
      _reqCount = 0;
      _resetTimer = null;
    }, 60_000);
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────
function _cacheKey(messages, system) {
  return 'ai_' + btoa(encodeURIComponent(system + JSON.stringify(messages))).slice(0, 40);
}

function _cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { value, expires } = JSON.parse(raw);
    if (Date.now() > expires) { sessionStorage.removeItem(key); return null; }
    return value;
  } catch { return null; }
}

function _cacheSet(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify({
      value,
      expires: Date.now() + CONFIG.CLAUDE_CACHE_TTL * 1000,
    }));
  } catch { /* sessionStorage voll — ignorieren */ }
}

// ── Core API Call ─────────────────────────────────────────────────────────────
/**
 * Sendet eine Anfrage an die Claude API.
 * @param {Array} messages - [{role: 'user'|'assistant', content: string}]
 * @param {string} system - System-Prompt
 * @param {number} maxTokens - Max. Output-Tokens
 * @param {boolean} useCache - Antwort cachen
 * @returns {Promise<string>} - Antwort-Text
 */
export async function callClaude(messages, system, maxTokens = 400, useCache = true) {
  const key = getApiKey();
  if (!key) throw new Error('Claude API Key fehlt — bitte in Einstellungen eintragen');
  if (!key.startsWith('sk-ant-')) throw new Error('Ungültiger API Key (muss mit sk-ant- beginnen)');

  // Cache prüfen
  if (useCache) {
    const cacheKey = _cacheKey(messages, system);
    const cached = _cacheGet(cacheKey);
    if (cached) return cached;
  }

  // Rate-Limit prüfen
  _checkRateLimit();

  const response = await fetch(CONFIG.CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || response.statusText;
    throw new Error(`API Fehler ${response.status}: ${msg}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  // Ergebnis cachen
  if (useCache && text) {
    _cacheSet(_cacheKey(messages, system), text);
  }

  return text;
}

// ── Spezifische KI-Funktionen ─────────────────────────────────────────────────

/**
 * Generiert Karteikarten aus einem Text.
 * @param {string} text - Lerninhalt
 * @param {number} grade - Klasse
 * @param {string} subject - Fach
 * @param {number} count - Anzahl Karten (max 10 für Budget)
 * @returns {Promise<Array<{front: string, back: string}>>}
 */
export async function generateCards(text, grade, subject, count = 5) {
  count = Math.min(count, 10); // Budget-Limit
  const system = `Du bist ein Lernassistent für Klasse ${grade}. Erstelle präzise Karteikarten auf Deutsch. Antworte NUR mit JSON, keine Erklärungen.`;
  const prompt = `Erstelle ${count} Karteikarten für ${subject} Klasse ${grade} aus diesem Text:\n\n${text.slice(0, 2000)}\n\nNur JSON: [{"front":"kurze Frage?","back":"prägnante Antwort"}]`;

  const result = await callClaude(
    [{ role: 'user', content: prompt }],
    system,
    CONFIG.CLAUDE_MAX_TOKENS_CARDS,
    true
  );

  const match = result.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('KI hat kein gültiges JSON zurückgegeben');
  const parsed = JSON.parse(match[0]);
  return parsed.filter(c => c.front && c.back);
}

/**
 * KI-Tutor Antwort.
 * @param {string} question - Schüler-Frage
 * @param {Array} history - Gesprächsverlauf (max. 6 Nachrichten)
 * @param {number} grade - Klasse
 * @param {string} subject - Fach (optional)
 * @returns {Promise<string>}
 */
export async function tutorAnswer(question, history = [], grade, subject = '') {
  const system = `Du bist StudyBuddy, ein freundlicher Lernassistent für Schüler der ${grade}. Klasse${subject ? ' im Fach ' + subject : ''}. Erkläre verständlich, ermutigend und auf Deutsch. Halte Antworten kurz (max. 3 Sätze) — bei Bedarf biete weitere Erklärungen an.`;

  // Maximal die letzten 6 Nachrichten für Budget-Kontrolle
  const trimmedHistory = history.slice(-6).map(m => ({
    role: m.role,
    content: m.content.slice(0, 500), // Nachrichten kürzen
  }));

  trimmedHistory.push({ role: 'user', content: question.slice(0, 500) });

  return callClaude(trimmedHistory, system, CONFIG.CLAUDE_MAX_TOKENS_TUTOR, false);
}

/**
 * Generiert Multiple-Choice-Prüfungsfragen.
 * @param {string} subject - Fach
 * @param {number} grade - Klasse
 * @param {number} count - Anzahl Fragen (max 10)
 * @returns {Promise<Array<{q: string, opts: string[], correct: number}>>}
 */
export async function generateExamQuestions(subject, grade, count = 5) {
  count = Math.min(count, 10);
  const system = `Du bist ein Prüfungsersteller für Klasse ${grade}. Erstelle Multiple-Choice-Fragen auf Deutsch. Antworte NUR mit JSON.`;
  const prompt = `${count} Multiple-Choice-Fragen zu ${subject} Klasse ${grade}. NUR JSON: [{"q":"Frage?","opts":["A","B","C","D"],"correct":0}] — correct=Index 0-3`;

  const result = await callClaude(
    [{ role: 'user', content: prompt }],
    system,
    CONFIG.CLAUDE_MAX_TOKENS_EXAM,
    true
  );

  const match = result.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('KI hat kein gültiges JSON zurückgegeben');
  return JSON.parse(match[0]).filter(q => q.q && q.opts?.length === 4);
}
