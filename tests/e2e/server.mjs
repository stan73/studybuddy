/**
 * Lokaler Server für die Playwright-Smoke-Tests.
 *
 * - Statische Auslieferung des Repo-Roots mit den Redirect-Regeln aus
 *   netlify.toml (/app/* → app.html, alles Unbekannte → index.html).
 * - js/vendor/neon-client.js wird beim Ausliefern auf den Dev-Branch
 *   umgebogen (E2E_NEON_AUTH_URL / E2E_NEON_DATA_API_URL), damit der Browser
 *   NIE gegen Produktion spricht.
 * - /.netlify/functions/<name> ruft die ECHTEN Function-Handler aus
 *   netlify/functions in-process auf (kein `netlify dev`, keine Secrets außer
 *   der Dev-Branch-Verbindung). DATABASE_URL/NEON_JWKS_URL kommen aus
 *   E2E_DATABASE_URL bzw. der Auth-URL des Branches.
 *
 * Port 8888 auf 127.0.0.1: dieser Origin steht in der Neon-Auth-Trusted-Liste
 * und im CORS-Allowlist der Functions.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PORT = Number(process.env.E2E_PORT || 8888);
const HOST = process.env.E2E_HOST || '127.0.0.1';
const AUTH_URL = (process.env.E2E_NEON_AUTH_URL || '').replace(/\/+$/, '');
const API_URL = (process.env.E2E_NEON_DATA_API_URL || '').replace(/\/+$/, '');
const DB_URL = process.env.E2E_DATABASE_URL || '';

if (/spring-brook|ep-royal-dew/i.test(AUTH_URL + API_URL + DB_URL)) {
  throw new Error(
    'tests/e2e: Produktions-Endpunkt erkannt — die E2E-Tests laufen nur gegen Dev-Branches.'
  );
}

// Functions in-process: Umgebung setzen, BEVOR die Module geladen werden.
if (DB_URL) process.env.DATABASE_URL = DB_URL;
if (AUTH_URL) process.env.NEON_JWKS_URL = `${AUTH_URL}/.well-known/jwks.json`;
process.env.URL = `http://${HOST}:${PORT}`;

const FUNCTIONS = {};
async function loadFunctions() {
  if (!DB_URL || !AUTH_URL) return;
  for (const name of ['link-profile', 'ai-proxy', 'child-token']) {
    FUNCTIONS[name] = (await import(`../../netlify/functions/${name}.mjs`)).default;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

async function fileOrNull(rel) {
  const abs = normalize(join(ROOT, rel));
  if (!abs.startsWith(ROOT)) return null;
  try {
    const st = await stat(abs);
    return st.isFile() ? abs : null;
  } catch {
    return null;
  }
}

function rewriteNeonClient(src) {
  let out = src;
  if (AUTH_URL) out = out.replace(/const AUTH_URL =\s*'[^']+';/, `const AUTH_URL = '${AUTH_URL}';`);
  if (API_URL)
    out = out.replace(
      /const DATA_API_URL =\s*\n?\s*'[^']+';/,
      `const DATA_API_URL = '${API_URL}';`
    );
  if ((AUTH_URL && !out.includes(AUTH_URL)) || (API_URL && !out.includes(API_URL))) {
    throw new Error(
      'neon-client.js: URL-Umschreibung fehlgeschlagen — Muster in js/vendor/neon-client.js prüfen'
    );
  }
  return out;
}

async function callFunction(name, req, res) {
  const handler = FUNCTIONS[name];
  if (!handler) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: `Function ${name} im E2E-Server nicht geladen (E2E_DATABASE_URL/E2E_NEON_AUTH_URL fehlen)`,
      })
    );
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const request = new Request(`http://${HOST}:${PORT}${req.url}`, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
  const response = await handler(request, {});
  const out = Buffer.from(await response.arrayBuffer());
  const h = {};
  response.headers.forEach((v, k) => {
    h[k] = v;
  });
  res.writeHead(response.status, h);
  res.end(out);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const path = decodeURIComponent(url.pathname);

    if (path === '/__e2e/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({ ok: true, server: 'studybuddy-e2e', functions: Object.keys(FUNCTIONS) })
      );
    }

    const fn = path.match(/^\/\.netlify\/functions\/([a-z-]+)$/);
    if (fn) return await callFunction(fn[1], req, res);

    let file = null;
    if (path.startsWith('/app/') || path === '/app') file = await fileOrNull('app.html');
    else if (path === '/') file = await fileOrNull('index.html');
    else file = await fileOrNull(path);
    if (!file) file = await fileOrNull('index.html'); // SPA-Fallback wie netlify.toml

    let data = await readFile(file);
    if (file.endsWith('/js/vendor/neon-client.js'))
      data = Buffer.from(rewriteNeonClient(data.toString('utf8')));
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`E2E-Server-Fehler: ${e.message}`);
  }
});

await loadFunctions();
server.listen(PORT, HOST, () => {
  console.log(
    `[e2e] StudyBuddy auf http://${HOST}:${PORT} (Auth: ${AUTH_URL || 'unverändert'}, Functions: ${Object.keys(FUNCTIONS).join(',') || 'keine'})`
  );
});
