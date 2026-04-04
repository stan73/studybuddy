/**
 * StudyBuddy Pro — Sicherer Storage-Wrapper
 *
 * Kein Passwort, kein API-Key im Klartext in localStorage.
 * API-Keys werden nur für die aktuelle Session im Memory gehalten.
 * Persistente Daten: nur nicht-sensitive App-State.
 *
 * CRA-Anforderung: Datenschutz und sichere Datenhaltung.
 */

// In-Memory Store für sensible Daten (kein localStorage!)
const memoryStore = new Map();

/**
 * Speichert einen Wert sicher.
 * Sensible Werte (api_key, token) → nur Memory (Session).
 * Alles andere → localStorage.
 * @param {string} key
 * @param {*} value
 * @param {boolean} sensitive - Wenn true: nur Memory
 */
export function storeSave(key, value, sensitive = false) {
  if (sensitive) {
    memoryStore.set(key, value);
    return;
  }
  try {
    localStorage.setItem(`sb_${key}`, JSON.stringify(value));
  } catch (e) {
    // localStorage voll oder nicht verfügbar → Memory fallback
    console.warn('[Storage] localStorage nicht verfügbar, nutze Memory:', e.message);
    memoryStore.set(key, value);
  }
}

/**
 * Liest einen gespeicherten Wert.
 * @param {string} key
 * @param {*} fallback - Standardwert wenn nicht gefunden
 * @param {boolean} sensitive
 * @returns {*}
 */
export function storeGet(key, fallback = null, sensitive = false) {
  if (sensitive) {
    return memoryStore.has(key) ? memoryStore.get(key) : fallback;
  }
  try {
    const raw = localStorage.getItem(`sb_${key}`);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

/**
 * Löscht einen Wert.
 * @param {string} key
 */
export function storeRemove(key) {
  memoryStore.delete(key);
  try { localStorage.removeItem(`sb_${key}`); } catch (e) { /* ignore */ }
}

/**
 * Löscht alle App-Daten (Account-Löschung / DSGVO-Recht auf Vergessenwerden).
 */
export function storeClear() {
  memoryStore.clear();
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb_')) keysToRemove.push(key);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

/**
 * API Key: immer nur Memory (nie persistiert).
 */
export function setApiKey(key) {
  memoryStore.set('api_key', key || '');
}

export function getApiKey() {
  return memoryStore.get('api_key') || '';
}

export function clearApiKey() {
  memoryStore.delete('api_key');
}
