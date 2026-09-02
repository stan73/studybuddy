/**
 * @file sw.js — StudyBuddy Pro Service Worker
 * @description PWA-Offline-Support und Caching-Strategie.
 *              Ermöglicht das Öffnen der App ohne Internetverbindung (App-Shell).
 *              API-Anfragen (Neon, Netlify Functions, KI-Provider) werden nie gecacht.
 * @version 2.1.0
 *
 * @caching_strategy
 *   HTML-Entry-Points (/, index.html, app.html, /app/*)
 *                                → Network First, Offline-Fallback auf die passende Shell
 *   Eigene CSS + neon-client.js  → Network First (klein, ändern sich mit jedem Deploy),
 *                                  Offline-Fallback aus dem Cache
 *   Große Vendor-Bibliotheken    → Cache First mit TTL (CACHE_TTL_MS) + Hintergrund-Update
 *   (neon-js.bundle, chart, xlsx, purify — versionsgepinnt, ändern sich nur bewusst)
 *   Neon / Functions / KI / MS   → nie abgefangen (Network Only)
 *   Non-GET                      → nie abgefangen
 *
 * @versioning
 *   Bei Änderungen an Vendor-Bibliotheken oder der PRECACHE-Liste: CACHE_NAME erhöhen.
 *   Der activate-Handler löscht automatisch alle alten Cache-Einträge.
 *   Eigene Assets (css/, neon-client.js) brauchen keinen Bump — sie sind Network First,
 *   und netlify.toml liefert /js/* und /css/* mit max-age=0, must-revalidate (ETag/304).
 *
 * @security
 *   API-Keys, JWT-Tokens und Backend-Antworten werden NIEMALS gecacht.
 *   Die NEVER_CACHE-Liste muss bei neuen externen Diensten erweitert werden.
 */

/** @type {string} Cache-Name — bei Asset-Änderungen inkrementieren */
const CACHE_NAME = "studybuddy-v6";

/** @type {number} Maximales Alter eines Cache-First-Eintrags (7 Tage) — danach Netz bevorzugen */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @type {number} Netz-Timeout für Network-First-Assets, wenn ein Cache-Treffer vorliegt */
const NETWORK_TIMEOUT_MS = 4000;

/**
 * App-Shell, die beim Install zwingend vorgecacht wird (addAll: alles oder nichts).
 * Klein gehalten, damit ein wackeliges Netz die SW-Installation nicht blockiert.
 * @type {string[]}
 */
const PRECACHE = [
  "/",
  "/index.html",
  "/app.html",
  "/css/variables.css",
  "/css/base.css",
  "/css/components.css",
  "/css/layout.css",
  "/js/vendor/neon-client.js",
  "/js/vendor/purify.min.js",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

/**
 * Große Vendor-Bibliotheken: beim Install best-effort einzeln vorgecacht.
 * Entscheidung für neon-js.bundle.js (494 KB): index.html UND app.html importieren es
 * bei jedem Besuch — ohne das Bundle ist die App-Shell offline nicht lauffähig
 * (kein Neon-Client). Der Install-Fetch kommt i. d. R. aus dem HTTP-Cache des
 * gerade geladenen Seitenaufrufs, kostet also praktisch kein zusätzliches Volumen.
 * Schlägt ein einzelner Download fehl, installiert der SW trotzdem; die Runtime-
 * Strategie unten holt die Datei beim ersten Zugriff nach.
 * @type {string[]}
 */
const PRECACHE_OPTIONAL = [
  "/js/vendor/neon-js.bundle.js",
  "/js/vendor/chart.umd.min.js",
  "/js/vendor/xlsx.full.min.js",
];

/** Versionsgepinnte Vendor-Bibliotheken → Cache First mit TTL. */
const VENDOR_CACHE_FIRST = [
  "/js/vendor/neon-js.bundle.js",
  "/js/vendor/chart.umd.min.js",
  "/js/vendor/xlsx.full.min.js",
  "/js/vendor/purify.min.js",
];

/**
 * URL-Fragmente, die der SW NIE abfängt (immer Netzwerk, nie Cache).
 * Sicherheitskritisch: API-Keys und Auth-Tokens dürfen nie gecacht werden.
 * @type {string[]}
 */
const NEVER_CACHE = [
  "neon.tech", // Neon Data API + Managed Better Auth (JWT-behaftet)
  "/.netlify/functions/", // Netlify Functions (ai-proxy, link-profile, child-token …)
  "anthropic.com",
  "openai.com",
  "generativelanguage.googleapis.com",
  "login.microsoftonline.com", // Schul-Login (Entra ID)
  "graph.microsoft.com",
];

// ── Installation ─────────────────────────────────────────────────────────
/**
 * Install-Event: App-Shell zwingend, große Vendor-Dateien best-effort vorcachen.
 * skipWaiting() aktiviert den neuen SW sofort (kein Warten auf Tab-Schließen).
 */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (c) => {
        await c.addAll(PRECACHE);
        await Promise.allSettled(
          PRECACHE_OPTIONAL.map((p) =>
            c
              .add(p)
              .catch((err) =>
                console.warn("[SW] Optionales Precache übersprungen:", p, err),
              ),
          ),
        );
      })
      .then(() => self.skipWaiting()),
  );
});

// ── Aktivierung: alte Caches löschen ────────────────────────────────────
/**
 * Activate-Event: Löscht alle Caches außer dem aktuellen CACHE_NAME.
 * clients.claim() übernimmt sofort die Kontrolle über alle offenen Tabs.
 */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ── Hilfsfunktionen ──────────────────────────────────────────────────────
/** Antwort im Cache ablegen (nur erfolgreiche, vollständige Antworten). */
async function putInCache(request, response) {
  if (!response || !response.ok || response.status === 206) return;
  // Synchron klonen, bevor das erste await läuft: die Antwort geht parallel an
  // die Seite, und ein bereits konsumierter Body lässt sich nicht mehr klonen.
  let clone;
  try {
    clone = response.clone();
  } catch (err) {
    return;
  }
  try {
    const c = await caches.open(CACHE_NAME);
    await c.put(request, clone);
  } catch (err) {
    console.warn("[SW] Cache-Put fehlgeschlagen:", request.url, err);
  }
}

/** Ist ein Cache-Eintrag älter als CACHE_TTL_MS (anhand des Date-Headers)? */
function isExpired(cached) {
  const d = cached && cached.headers.get("date");
  if (!d) return false; // ohne Datum: als frisch behandeln
  const age = Date.now() - new Date(d).getTime();
  return Number.isFinite(age) && age > CACHE_TTL_MS;
}

/** fetch mit Timeout — bricht ab, wenn das Netz zu lange braucht. */
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Offline-Shell für eine Navigation: /app.html für App-Routen, sonst /index.html. */
function shellFor(pathname) {
  const isApp =
    pathname === "/app.html" ||
    pathname === "/app" ||
    pathname.startsWith("/app/");
  return isApp ? "/app.html" : "/index.html";
}

/** Network First: frische Antwort bevorzugen, Cache als Offline-Fallback. */
async function networkFirst(request, fallbackUrl) {
  const cached = await caches.match(request);
  try {
    const res = cached
      ? await fetchWithTimeout(request, NETWORK_TIMEOUT_MS) // mit Fallback: nicht ewig warten
      : await fetch(request);
    if (res && res.ok) putInCache(request, res);
    if (res && res.ok) return res;
    if (cached) return cached;
    return res;
  } catch (err) {
    if (cached) return cached;
    if (fallbackUrl) {
      const shell = await caches.match(fallbackUrl);
      if (shell) return shell;
    }
    throw err;
  }
}

/** Cache First mit TTL: frischer Cache-Treffer sofort, Update im Hintergrund; abgelaufen → Netz zuerst. */
async function cacheFirstWithTtl(request) {
  const cached = await caches.match(request);
  if (cached && !isExpired(cached)) {
    fetch(request)
      .then((res) => putInCache(request, res))
      .catch(() => {}); // stille Auffrischung
    return cached;
  }
  try {
    const res = await fetch(request);
    if (res && res.ok) putInCache(request, res);
    return res.ok || !cached ? res : cached;
  } catch (err) {
    if (cached) return cached; // abgelaufen, aber besser als nichts (offline)
    throw err;
  }
}

// ── Fetch-Strategie (ein einziger Listener) ──────────────────────────────
/**
 * Reihenfolge der Checks:
 *   1. NEVER_CACHE / Non-GET / fremde Origins → nicht abfangen (Netzwerk)
 *   2. Navigationen + HTML-Entry-Points        → Network First, Offline-Shell passend zur Route
 *   3. Vendor-Bibliotheken (gepinnt)           → Cache First mit TTL
 *   4. /css/*, /js/* (eigene Assets)           → Network First mit Cache-Fallback
 *   5. Manifest / Icons                        → Cache First mit TTL
 *   6. Sonstige                                → nicht abfangen
 */
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (NEVER_CACHE.some((n) => req.url.includes(n))) return;

  let url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  // 2. Navigationen und HTML-Entry-Points
  const isHtml =
    req.mode === "navigate" ||
    path === "/" ||
    path === "/index.html" ||
    path === "/app.html";
  if (isHtml) {
    e.respondWith(networkFirst(req, shellFor(path)));
    return;
  }

  // 3. Gepinnte Vendor-Bibliotheken
  if (VENDOR_CACHE_FIRST.includes(path)) {
    e.respondWith(cacheFirstWithTtl(req));
    return;
  }

  // 4. Eigene Assets (ändern sich mit Deploys)
  if (path.startsWith("/css/") || path.startsWith("/js/")) {
    e.respondWith(networkFirst(req, null));
    return;
  }

  // 5. Manifest / Icons
  if (path === "/manifest.json" || path.startsWith("/icons/")) {
    e.respondWith(cacheFirstWithTtl(req));
  }
});
