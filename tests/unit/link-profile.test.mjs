/**
 * netlify/functions/link-profile.mjs — echte Ausführung.
 * Befunde aus dem Review: kein JWT → 401; unverifizierte E-Mail darf kein
 * fremdes Profil übernehmen (403 email_unverified); body.email darf die
 * E-Mail aus neon_auth."user" NIE überschreiben (Konto-Übernahme).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UUID_A,
  UUID_B,
  fakeSql,
  joseMockFactory,
  postJson,
  readJson,
  signJwt,
} from './helpers.mjs';

vi.mock('@neondatabase/serverless', () => ({ neon: () => fakeSql }));
vi.mock('jose', (importOriginal) => joseMockFactory(importOriginal));

const { default: handler } = await import('../../netlify/functions/link-profile.mjs');

const PATH = '/.netlify/functions/link-profile';
const AUTH_EMAIL = 'Angreifer@Example.com';
const VICTIM_EMAIL = 'opfer@example.com';

/**
 * DB-Zustand: profil_by_id (eigene Zeile vorhanden?), auth_user (Zeile aus
 * neon_auth."user"), profil_by_email (Zeile mit gleicher E-Mail, alte ID).
 */
function db({ byId = [], authUser = [], byEmail = [] } = {}) {
  fakeSql.on((text) => {
    if (text.includes('from public.profiles where id')) return byId;
    if (text.includes('from neon_auth."user"')) return authUser;
    if (text.includes('from public.profiles where lower(email)')) return byEmail;
    if (text.startsWith('update public.profiles')) return [];
    if (text.startsWith('insert into public.profiles')) return [];
    throw new Error(`fakeSql: unerwartete Abfrage: ${text}`);
  });
}

beforeEach(() => {
  fakeSql.reset();
  db();
});

async function call(body, headers) {
  const res = await handler(postJson(PATH, body, headers));
  return { res, json: await readJson(res) };
}
async function asUser(sub, body = {}, opts) {
  const jwt = await signJwt(sub, opts);
  return call(body, { authorization: `Bearer ${jwt}` });
}

describe('Zugang', () => {
  it('kein JWT → 401, keine DB-Abfrage', async () => {
    const { res, json } = await call({});
    expect(res.status).toBe(401);
    expect(json.error).toMatch(/Nicht autorisiert/);
    expect(fakeSql.calls).toHaveLength(0);
  });

  it('abgelaufenes oder fremd signiertes JWT → 401', async () => {
    expect((await asUser(UUID_A, {}, { expiresIn: -10 })).res.status).toBe(401);
    expect((await asUser(UUID_A, {}, { foreignKey: true })).res.status).toBe(401);
    expect(fakeSql.calls).toHaveLength(0);
  });

  it('GET → 405, OPTIONS → Preflight', async () => {
    const get = await handler(new Request(`http://localhost:8888${PATH}`, { method: 'GET' }));
    expect(get.status).toBe(405);
    const pre = await handler(new Request(`http://localhost:8888${PATH}`, { method: 'OPTIONS' }));
    expect(pre.status).toBe(200);
  });
});

describe('Verknüpfung', () => {
  it('Profil mit id = sub existiert → nichts zu tun', async () => {
    db({ byId: [{ id: UUID_A }] });
    const { res, json } = await asUser(UUID_A);
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, linked: false });
    expect(fakeSql.find('neon_auth')).toHaveLength(0);
  });

  it('Auth-Konto ohne E-Mail → 400', async () => {
    db({ authUser: [{ email: null, name: 'x', verified: true }] });
    const { res } = await asUser(UUID_A);
    expect(res.status).toBe(400);
  });

  it('unverifizierte E-Mail + bestehendes Profil → 403 email_unverified, KEIN Update', async () => {
    db({
      authUser: [{ email: AUTH_EMAIL, name: 'A', verified: false }],
      byEmail: [{ id: UUID_B }],
    });
    const { res, json } = await asUser(UUID_A);
    expect(res.status).toBe(403);
    expect(json.code).toBe('email_unverified');
    expect(fakeSql.find('update public.profiles')).toHaveLength(0);
    expect(fakeSql.find('insert into public.profiles')).toHaveLength(0);
  });

  it('verified fehlt/ist kein true (z. B. "true" als String) → ebenfalls 403', async () => {
    for (const verified of [undefined, null, 'true', 1]) {
      db({ authUser: [{ email: AUTH_EMAIL, verified }], byEmail: [{ id: UUID_B }] });
      const { res } = await asUser(UUID_A);
      expect(res.status, String(verified)).toBe(403);
    }
  });

  it('verifizierte E-Mail + migriertes Profil → Profil wird auf sub umgehängt', async () => {
    db({
      authUser: [{ email: AUTH_EMAIL, name: 'A', verified: true }],
      byEmail: [{ id: UUID_B }],
    });
    const { res, json } = await asUser(UUID_A);
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, linked: true, migrated: true });
    const upd = fakeSql.find('update public.profiles');
    expect(upd).toHaveLength(1);
    expect(upd[0].values).toEqual([UUID_A, 'angreifer@example.com']);
  });

  it('frisches Profil: id = sub, E-Mail aus Auth (normalisiert), Name gekürzt', async () => {
    db({ authUser: [{ email: `  ${AUTH_EMAIL} `, name: 'AuthName', verified: false }] });
    const { res, json } = await asUser(UUID_A, { full_name: 'X'.repeat(500) });
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, linked: true, created: true });
    const ins = fakeSql.find('insert into public.profiles');
    expect(ins).toHaveLength(1);
    expect(ins[0].values).toEqual([UUID_A, 'angreifer@example.com', 'X'.repeat(120)]);
  });

  it('DB-Fehler → 500 mit Fehlertext, nicht 200', async () => {
    fakeSql.on(() => {
      throw new Error('connection refused');
    });
    const { res, json } = await asUser(UUID_A);
    expect(res.status).toBe(500);
    expect(json.error).toBe('connection refused');
  });
});

describe('Konto-Übernahme: body.email zählt nie', () => {
  it('body.email = Opfer-Adresse: es wird ausschließlich mit der Auth-E-Mail gesucht/geschrieben', async () => {
    db({
      authUser: [{ email: AUTH_EMAIL, name: 'A', verified: true }],
      byEmail: [], // zur Auth-E-Mail gibt es kein Profil → frisches Profil
    });
    const { res, json } = await asUser(UUID_A, { email: VICTIM_EMAIL, id: UUID_B });
    expect(res.status).toBe(200);
    expect(json.created).toBe(true);
    const allValues = fakeSql.calls.flatMap((c) => c.values.map(String));
    expect(allValues).not.toContain(VICTIM_EMAIL);
    expect(allValues).not.toContain(UUID_B);
    expect(fakeSql.find('where lower(email)')[0].values).toEqual(['angreifer@example.com']);
  });

  it('body.email mit bestehendem Opfer-Profil: kein Update auf das fremde Profil', async () => {
    // Das Opfer-Profil existiert (byEmail würde NUR für die Auth-E-Mail suchen);
    // für die Auth-E-Mail gibt es nichts → es darf nur ein eigenes Profil entstehen.
    db({ authUser: [{ email: AUTH_EMAIL, verified: true }], byEmail: [] });
    await asUser(UUID_A, { email: VICTIM_EMAIL });
    expect(fakeSql.find('update public.profiles')).toHaveLength(0);
    for (const c of fakeSql.calls) expect(c.values.map(String)).not.toContain(VICTIM_EMAIL);
  });
});
