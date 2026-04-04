/**
 * StudyBuddy Pro — SPA Router (Hash-basiert)
 * Einfaches clientseitiges Routing ohne Framework.
 * Hash-Routing (#/dashboard) funktioniert ohne Server-Konfiguration.
 */

import { state } from './state.js';

// Registrierte Seiten: { pageName: { render: fn, title: string, roles: string[] } }
const routes = new Map();

// Aktuelle Cleanup-Funktion der aktiven Seite
let currentCleanup = null;

/**
 * Registriert eine Seite.
 * @param {string} name - z.B. 'dashboard'
 * @param {object} config - { render, title, roles }
 */
export function registerPage(name, config) {
  routes.set(name, config);
}

/**
 * Navigiert zu einer Seite.
 * @param {string} page
 * @param {object} params - Optionale URL-Parameter
 */
export function navigate(page, params = {}) {
  const hash = params && Object.keys(params).length > 0
    ? `#/${page}?${new URLSearchParams(params)}`
    : `#/${page}`;
  window.location.hash = hash;
}

/**
 * Initialisiert den Router (einmalig beim App-Start aufrufen).
 * @param {string} defaultPage - Fallback-Seite
 * @param {HTMLElement} contentEl - Container für Seiteninhalte
 */
export function initRouter(defaultPage, contentEl) {
  const render = () => _renderRoute(contentEl, defaultPage);
  window.addEventListener('hashchange', render);
  render();
}

/**
 * Gibt die aktuelle Seite aus dem Hash zurück.
 * @returns {string}
 */
export function getCurrentPage() {
  const hash = window.location.hash.replace('#/', '') || '';
  return hash.split('?')[0] || 'dashboard';
}

// ── Internes Rendering ────────────────────────────────────────────────────────

async function _renderRoute(contentEl, defaultPage) {
  const page = getCurrentPage() || defaultPage;

  // Cleanup vorherige Seite
  if (currentCleanup) {
    try { currentCleanup(); } catch (e) { /* ignore */ }
    currentCleanup = null;
  }

  const route = routes.get(page);
  if (!route) {
    // Unbekannte Route → Fallback
    navigate(defaultPage);
    return;
  }

  // Rollen-Check
  if (route.roles && route.roles.length > 0) {
    const userRole = state.user?.role;
    if (!route.roles.includes(userRole)) {
      navigate(defaultPage);
      return;
    }
  }

  // Seiten-Titel setzen
  if (route.title) {
    document.title = `${route.title} — StudyBuddy Pro`;
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.textContent = route.title;
  }

  // Aktiven Nav-Item markieren
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // State aktualisieren
  state.currentPage = page;

  // Seite rendern
  try {
    const cleanup = await route.render(contentEl, _parseParams());
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (e) {
    console.error('[Router] Fehler beim Rendern:', page, e);
    contentEl.innerHTML = `
      <div style="text-align:center;padding:60px 20px">
        <div style="font-size:48px;margin-bottom:16px">⚠️</div>
        <h2>Seite konnte nicht geladen werden</h2>
        <p style="color:var(--t3);margin-top:8px">${e.message}</p>
        <button class="btn btn-primary" style="margin-top:24px" onclick="navigate('dashboard')">
          Zum Dashboard
        </button>
      </div>
    `;
  }
}

function _parseParams() {
  const hash = window.location.hash.replace('#/', '');
  const [, queryStr] = hash.split('?');
  if (!queryStr) return {};
  return Object.fromEntries(new URLSearchParams(queryStr));
}
