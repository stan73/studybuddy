/**
 * @file sw.js — StudyBuddy Pro Service Worker
 * @description PWA-Offline-Support und Caching-Strategie.
 *              Ermöglicht das Öffnen der App ohne Internetverbindung (App-Shell).
 *              API-Anfragen (Supabase, KI-Provider) werden nie gecacht.
 * @version 2.0.0
 *
 * @caching_strategy
 *   App-Shell (HTML/CSS/JS/Icons) → Cache First (offline vollständig nutzbar)
 *   CDN-Assets (DOMPurify, Chart.js, Supabase JS) → Stale-While-Revalidate
 *   Supabase-API / KI-Provider / Edge Functions → Network Only (nie cachen!)
 *   POST-Anfragen → Network Only (immer)
 *
 * @versioning
 *   Bei Änderungen an gecachten Assets: CACHE_NAME erhöhen (z.B. 'studybuddy-v3').
 *   Der activate-Handler löscht automatisch alle alten Cache-Einträge.
 *
 * @security
 *   API-Keys, JWT-Tokens und Supabase-Antworten werden NIEMALS gecacht.
 *   Die NEVER_CACHE-Liste muss bei neuen externen Diensten erweitert werden.
 */

/** @type {string} Cache-Name — bei Asset-Änderungen inkrementieren */
const CACHE_NAME = 'studybuddy-v3';
/** @type {number} Maximales Cachealter in Millisekunden (7 Tage) */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

/**
 * App-Shell-Dateien, die beim Service Worker Install vorgecacht werden.
 * Änderungen hier erfordern eine Erhöhung von CACHE_NAME.
 * @type {string[]}
 */
const PRECACHE = [
  '/',
  '/index.html',
  '/app.html',
  '/css/variables.css',
  '/css/base.css',
  '/css/components.css',
  '/css/layout.css',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

/**
 * URL-Fragmente, bei denen IMMER das Netzwerk genutzt wird.
 * Sicherheitskritisch: API-Keys und Auth-Tokens dürfen nie gecacht werden.
 * Bei neuen KI-Providern oder Supabase-Subdomains hier erweitern.
 * @type {string[]}
 */
const NEVER_CACHE = [
  'supabase.co',
  'anthropic.com',
  'openai.com',
  'generativelanguage.googleapis.com',
  'functions/v1/',
];

// ── Installation ─────────────────────────────────────────────────────────
/**
 * Install-Event: Alle PRECACHE-Dateien werden in den Cache geladen.
 * skipWaiting() aktiviert den neuen SW sofort (kein Warten auf Tab-Schließen).
 */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// ── Aktivierung: alte Caches löschen ────────────────────────────────────
/**
 * Activate-Event: Löscht alle Caches außer dem aktuellen CACHE_NAME.
 * clients.claim() übernimmt sofort die Kontrolle über alle offenen Tabs.
 */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch-Strategie ──────────────────────────────────────────────────────
/**
 * Fetch-Event: Routing aller Netzwerkanfragen nach Caching-Strategie.
 * Reihenfolge der Checks:
 *   1. NEVER_CACHE → direktes Netzwerk
 *   2. Non-GET     → kein Caching
 *   3. PRECACHE    → Cache First + Hintergrund-Update
 *   4. CDN         → Stale-While-Revalidate
 *   5. Sonstige    → Netzwerk ohne Caching
 */
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Sensible/dynamische Anfragen: immer Netzwerk
  if (NEVER_CACHE.some(n => url.includes(n))) {
    e.respondWith(fetch(e.request));
    return;
  }

  // POST-Anfragen: nicht cachen
  if (e.request.method !== 'GET') return;

  // App-Shell: Cache First mit Netzwerk-Fallback
  if (PRECACHE.some(p => url.endsWith(p) || url === location.origin + p)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // CDN-Ressourcen (DOMPurify, Supabase JS, Chart.js): Stale-While-Revalidate
  if (url.includes('cdnjs.cloudflare.com') || url.includes('cdn.jsdelivr.net')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => {
          const fresh = fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          });
          return cached || fresh;
        })
      )
    );
    return;
  }
});

// ── Offline-Fallback für HTML-Seiten ─────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
  }
});
