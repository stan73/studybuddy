/**
 * StudyBuddy Pro — Input-Sanitization (XSS-Schutz)
 *
 * Alle User-Inputs, die ins DOM geschrieben werden, müssen
 * durch sanitize() laufen. DOMPurify wird als CDN geladen.
 *
 * CRA-Anforderung: Schutz gegen Code-Injection (OWASP A03)
 */

// DOMPurify wird via CDN in index.html / app.html geladen.
// Diese Datei stellt einen sicheren Wrapper bereit.

/**
 * Bereinigt HTML-String gegen XSS.
 * @param {string} dirty - Möglicherweise unsicherer String
 * @param {object} options - DOMPurify-Optionen
 * @returns {string} Sicherer, bereinigter String
 */
export function sanitizeHTML(dirty, options = {}) {
  if (typeof dirty !== 'string') return '';
  if (typeof window.DOMPurify === 'undefined') {
    // Fallback: einfaches Escaping wenn DOMPurify nicht geladen
    return escapeHTML(dirty);
  }
  return window.DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'br', 'p', 'ul', 'ol', 'li', 'code', 'pre'],
    ALLOWED_ATTR: [],
    ...options,
  });
}

/**
 * Escaping für reinen Text (kein HTML erlaubt).
 * Für Inputs die direkt als textContent gesetzt werden.
 * @param {string} str
 * @returns {string}
 */
export function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Validiert und bereinigt E-Mail-Adressen.
 * @param {string} email
 * @returns {{ valid: boolean, value: string }}
 */
export function validateEmail(email) {
  if (typeof email !== 'string') return { valid: false, value: '' };
  const trimmed = email.trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  return { valid, value: trimmed };
}

/**
 * Validiert Passwort-Stärke (CRA: keine schwachen Passwörter).
 * Mindestanforderungen: 8 Zeichen, 1 Zahl, 1 Großbuchstabe.
 * @param {string} password
 * @returns {{ valid: boolean, message: string }}
 */
export function validatePassword(password) {
  if (typeof password !== 'string') return { valid: false, message: 'Passwort erforderlich' };
  if (password.length < 8) return { valid: false, message: 'Mindestens 8 Zeichen erforderlich' };
  if (!/[0-9]/.test(password)) return { valid: false, message: 'Mindestens eine Zahl erforderlich' };
  if (!/[A-Z]/.test(password)) return { valid: false, message: 'Mindestens ein Großbuchstabe erforderlich' };
  return { valid: true, message: '' };
}

/**
 * Bereinigt Freitext-Inputs (z.B. Karteikarten-Vorderseite).
 * Entfernt führende/nachfolgende Leerzeichen, begrenzt Länge.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function sanitizeText(text, maxLength = 1000) {
  if (typeof text !== 'string') return '';
  return text.trim().slice(0, maxLength);
}

/**
 * Setzt Text sicher als textContent (nie innerHTML).
 * Verhindert XSS grundsätzlich durch DOM-API.
 * @param {HTMLElement} element
 * @param {string} text
 */
export function setTextSafe(element, text) {
  if (!element) return;
  element.textContent = typeof text === 'string' ? text : '';
}
