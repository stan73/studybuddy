// StudyBuddy Pro — Service Worker
// Version 2.0 | Offline-Support & Caching
//
// Strategie:
//  • App-Shell (HTML/CSS/JS) → Cache First (Offline möglich)
//  • KI-Anfragen & Supabase → Network Only (kein Caching sensibler Daten)
//  • Statische Assets (Icons, Bilder) → Stale-While-Revalidate

const CACHE_NAME = 'studybuddy-v2';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

// App-Shell: diese Dateien immer cachen
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

// Nie cachen (sensible/dynamische Anfragen)
const NEVER_CACHE = [
  'supabase.co',
  'anthropic.com',
  'openai.com',
  'generativelanguage.googleapis.com',
  'functions/v1/',
];

// ── Installation ─────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// ── Aktivierung: alte Caches löschen ────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch-Strategie ──────────────────────────────────────────────────────
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
