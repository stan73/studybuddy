/**
 * Helfer für die SQL-/RLS-Tests: Owner-Verbindung (Transaktionen mit Rollback,
 * Rollenwechsel per SET LOCAL ROLE), Neon-Auth-HTTP (Sign-up → Cookie → JWT) und
 * Data-API-Aufrufe (PostgREST-kompatibel) — genau der Pfad, den der Browser nimmt.
 */
import { Pool } from '@neondatabase/serverless';
import { API_URL, AUTH_ORIGIN, AUTH_URL, DB_URL } from './env.mjs';

export const TEST_MAIL_DOMAIN = 'studybuddy-test.invalid';
export const TEST_PASSWORD = 'Test-Passwort-1234!';

export function testEmail(tag) {
  return `sb-test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${TEST_MAIL_DOMAIN}`;
}

export function openPool() {
  return new Pool({ connectionString: DB_URL, max: 2 });
}

/** Führt fn in einer Transaktion aus und rollt IMMER zurück (nichts bleibt liegen). */
export async function inRolledBackTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    try {
      return await fn(client);
    } finally {
      await client.query('rollback');
    }
  } finally {
    client.release();
  }
}

/**
 * Führt fn als Client-Rolle (authenticated/anonymous) innerhalb der laufenden
 * Transaktion aus. Erfolgreiche Schreibvorgänge bleiben bis zum Rollback der
 * äußeren Transaktion sichtbar (Owner kann sie prüfen); nach einem Fehler wird
 * auf den Savepoint zurückgesetzt, damit die Transaktion benutzbar bleibt.
 */
export async function asRole(client, role, fn) {
  if (!['authenticated', 'anonymous'].includes(role))
    throw new Error(`Rolle ${role} nicht erlaubt`);
  await client.query('savepoint role_switch');
  await client.query(`set local role ${role}`);
  let result;
  try {
    result = await fn();
  } catch (e) {
    await client.query('rollback to savepoint role_switch');
    throw e;
  }
  try {
    await client.query('release savepoint role_switch');
    await client.query('reset role');
  } catch {
    // Transaktion war durch einen (per pgError abgefangenen) Fehler abgebrochen
    await client.query('rollback to savepoint role_switch');
  }
  return result;
}

/** Fängt einen Postgres-Fehler und liefert { code, message } statt zu werfen. */
export async function pgError(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return { code: e.code, message: e.message };
  }
}

// ── Neon Auth (Better Auth) über HTTP ─────────────────────────────────────────

async function authFetch(path, init = {}) {
  const res = await fetch(`${AUTH_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', origin: AUTH_ORIGIN, ...(init.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* kein JSON */
  }
  return { res, json, text };
}

function cookieHeader(res) {
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

/** Registriert einen Testnutzer und liefert { id, email, cookie, jwt }. */
export async function signUpUser(tag, name = 'Testnutzer') {
  const email = testEmail(tag);
  const { res, json, text } = await authFetch('/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ email, password: TEST_PASSWORD, name }),
  });
  if (res.status !== 200 || !json?.user?.id) {
    throw new Error(`Neon-Auth-Sign-up fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`);
  }
  const cookie = cookieHeader(res);
  if (!cookie) throw new Error('Neon-Auth-Sign-up ohne Session-Cookie');
  const jwt = await fetchJwt(cookie);
  return { id: json.user.id, email, cookie, jwt };
}

export async function signIn(email, password = TEST_PASSWORD) {
  const { res, json, text } = await authFetch('/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, json, text, cookie: cookieHeader(res) };
}

/** Holt das Data-API-JWT für eine Session (so macht es auch das neon-js SDK). */
export async function fetchJwt(cookie) {
  const { res, json, text } = await authFetch('/token', { headers: { cookie } });
  if (res.status !== 200 || typeof json?.token !== 'string') {
    throw new Error(`JWT-Abruf fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`);
  }
  return json.token;
}

export function jwtPayload(jwt) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
}

// ── Neon Data API (PostgREST-kompatibel) ─────────────────────────────────────

/** Roh-Aufruf; jwt = null → anonym (ohne Authorization). */
export async function api(jwt, path, init = {}) {
  const headers = { 'content-type': 'application/json', ...(init.headers || {}) };
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* kein JSON */
  }
  return { status: res.status, json, text };
}

export function rpc(jwt, name, args = {}) {
  return api(jwt, `/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
}

/**
 * Wärmt Branch-Endpunkte auf (frisch erzeugte Neon-Branches starten kalt) und
 * wiederholt bei Netz-/Kaltstartfehlern, damit der erste echte Test nicht an
 * einem Timeout scheitert.
 */
export async function warmUp() {
  const targets = [`${AUTH_URL}/.well-known/jwks.json`, `${API_URL}/`];
  for (const url of targets) {
    let lastErr = null;
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (res.status < 500) {
          lastErr = null;
          break;
        }
        lastErr = new Error(`${url} → ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
    if (lastErr) throw new Error(`Warm-up fehlgeschlagen: ${lastErr.message}`);
  }
}

/** Wiederholt fn, solange shouldRetry(result) true liefert (Kaltstart-Toleranz). */
export async function retry(fn, shouldRetry, attempts = 3) {
  let result;
  for (let i = 0; i < attempts; i++) {
    result = await fn();
    if (!shouldRetry(result)) return result;
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return result;
}

// ── Aufräumen ────────────────────────────────────────────────────────────────

/** Löscht alle Testnutzer (Auth-Konten, Profile, Kaskaden) und belegt es per Zählung. */
export async function cleanupTestUsers(pool) {
  const like = `%@${TEST_MAIL_DOMAIN}`;
  await pool.query(`delete from public.profiles where lower(email) like $1`, [like]);
  await pool.query(`delete from neon_auth."user" where lower(email) like $1`, [like]);
  const { rows } = await pool.query(
    `select
       (select count(*)::int from neon_auth."user" where lower(email) like $1) as users,
       (select count(*)::int from public.profiles where lower(email) like $1) as profiles,
       (select count(*)::int from public.cards c where not exists (select 1 from public.profiles p where p.id = c.user_id)) as orphan_cards`,
    [like]
  );
  return rows[0];
}
