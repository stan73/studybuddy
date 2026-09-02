/**
 * Eltern-Cloud-Persistenz und Fremdzugriff über den ECHTEN Produktionspfad:
 * Neon Auth (Sign-up → Session → JWT) → link-profile (echte Netlify Function,
 * in-process gegen den Dev-Branch) → Neon Data API (rpc/sync_my_data,
 * rpc/load_my_data, Tabellenzugriff unter RLS).
 *
 * „Der Test, der den Sieben-Wochen-Ausfall gefunden hätte“: schreiben → lesen →
 * vergleichen als Rolle authenticated mit echtem JWT. Er wird rot, sobald
 * jemand SECURITY DEFINER oder den search_path an sync_my_data/load_my_data
 * wieder entfernt (Antwort der Data API: 42501 statt Daten).
 *
 * Braucht TEST_DATABASE_URL, TEST_NEON_AUTH_URL, TEST_DATA_API_URL (Dev-Branch).
 * Testkonten werden am Ende restlos gelöscht und die Löschung belegt.
 * Seit Härtung 1.1 (Konflikterkennung) sendet der Client p_base_version mit;
 * die Konfliktfälle selbst stehen in sync-conflict.test.mjs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_URL, AUTH_URL, DB_URL, hasApi } from './env.mjs';
import {
  api,
  cleanupTestUsers,
  fetchJwt,
  jwtPayload,
  openPool,
  retry,
  rpc,
  signIn,
  signUpUser,
  warmUp,
} from './helpers.mjs';

const CARDS = [
  {
    id: '5a5a5a5a-0000-4000-8000-000000000001',
    subject: 'Mathe',
    front: 'Was ist 7 · 8?',
    back: '56',
    level: 2,
  },
  { subject: 'Englisch', front: 'to persist', back: 'fortbestehen', topic: 'Vokabeln' },
];
const TASKS = [{ title: 'Vokabeln wiederholen', subject: 'Englisch', due_at: '2026-09-10' }];
const EXAMS = [{ subject: 'Mathe', score: 8, total: 10 }];

describe.skipIf(!hasApi)('Eltern-Persistenz über Neon Auth + Data API (Dev-Branch)', () => {
  let pool;
  let linkProfile;
  let A;
  let B;

  beforeAll(async () => {
    pool = openPool();
    // Die echte Function gegen den Dev-Branch: DB-URL und JWKS des Branches.
    process.env.DATABASE_URL = DB_URL;
    process.env.NEON_JWKS_URL = `${AUTH_URL}/.well-known/jwks.json`;
    linkProfile = (await import('../../netlify/functions/link-profile.mjs')).default;
    await warmUp();
    await pool.query('select 1');
    A = await signUpUser('a', 'Eltern A');
    B = await signUpUser('b', 'Eltern B');
  });

  afterAll(async () => {
    if (pool) {
      await cleanupTestUsers(pool);
      await pool.end();
    }
  });

  async function link(user) {
    // Kaltstart-Toleranz: JWKS-Abruf der Function kann beim ersten Mal zu langsam sein.
    return retry(
      () => linkOnce(user),
      (r) => r.status === 401 || r.status >= 500
    );
  }
  async function linkOnce(user) {
    const res = await linkProfile(
      new Request('http://localhost:8888/.netlify/functions/link-profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${user.jwt}` },
        body: JSON.stringify({ full_name: 'Testnutzer', email: 'ignoriert@example.com' }),
      })
    );
    return { status: res.status, json: await res.json() };
  }

  it('Sign-up liefert ein JWT, dessen sub die Auth-User-ID ist', () => {
    expect(jwtPayload(A.jwt).sub).toBe(A.id);
    expect(jwtPayload(B.jwt).sub).toBe(B.id);
    expect(A.id).not.toBe(B.id);
  });

  it('link-profile (echte Function) legt die profiles-Zeile mit id = sub und der Auth-E-Mail an', async () => {
    const ra = await link(A);
    expect(ra).toEqual({ status: 200, json: { ok: true, linked: true, created: true } });
    const rb = await link(B);
    expect(rb.json.created).toBe(true);
    const { rows } = await pool.query(
      'select id, email from profiles where id = any($1::uuid[]) order by email',
      [[A.id, B.id]]
    );
    expect(rows).toEqual([
      { id: A.id, email: A.email },
      { id: B.id, email: B.email },
    ]);
    // idempotent
    expect((await link(A)).json).toEqual({ ok: true, linked: false });
  });

  it('SIEBEN-WOCHEN-TEST: sync_my_data → load_my_data als authenticated mit echtem JWT (Roundtrip)', async () => {
    // Seit Härtung 1.1 verlangt sync_my_data die zuletzt geladene Datenversion
    const v0 = await rpc(A.jwt, 'load_my_data', {});
    expect(v0.status, v0.text).toBe(200);
    expect(v0.json.version).toBe(0);
    const sync = await rpc(A.jwt, 'sync_my_data', {
      p_cards: CARDS,
      p_tasks: TASKS,
      p_exams: EXAMS,
      p_base_version: v0.json.version,
    });
    expect(sync.status, sync.text).toBeLessThan(300);
    expect(sync.json).toMatchObject({ ok: true, version: 1 });
    const load = await rpc(A.jwt, 'load_my_data', {});
    expect(load.status, load.text).toBe(200);
    expect(load.json.cards).toHaveLength(2);
    expect(load.json.cards.find((c) => c.id === CARDS[0].id)).toMatchObject({
      subject: 'Mathe',
      front: 'Was ist 7 · 8?',
      back: '56',
      level: 2,
    });
    expect(load.json.cards.find((c) => c.front === 'to persist')).toMatchObject({
      topic: 'Vokabeln',
      back: 'fortbestehen',
    });
    expect(load.json.tasks).toHaveLength(1);
    expect(load.json.tasks[0]).toMatchObject({
      title: 'Vokabeln wiederholen',
      due_at: '2026-09-10',
      completed: false,
    });
    expect(load.json.exams).toHaveLength(1);
    expect(load.json.exams[0]).toMatchObject({ subject: 'Mathe', score: 8, total: 10 });
    // und die Zeilen hängen wirklich am richtigen Nutzer (Owner-Sicht)
    const { rows } = await pool.query(
      'select count(*)::int as n from cards where user_id = $1 and child_id is null',
      [A.id]
    );
    expect(rows[0].n).toBe(2);
  });

  it('zweite Sitzung (neues JWT) sieht dieselben Daten — das ist der Reload-Pfad', async () => {
    const jwt2 = await fetchJwt(A.cookie);
    expect(jwt2).not.toBe(A.jwt);
    const load = await rpc(jwt2, 'load_my_data', {});
    expect(load.status).toBe(200);
    expect(load.json.cards.map((c) => c.front).sort()).toEqual(['Was ist 7 · 8?', 'to persist']);
  });

  it('Fremdzugriff über RPC: B sieht nichts von A, Bs Sync verändert A nicht', async () => {
    const before = await rpc(B.jwt, 'load_my_data', {});
    expect(before.status).toBe(200);
    expect(before.json).toEqual({ version: 0, cards: [], tasks: [], exams: [] });
    const sync = await rpc(B.jwt, 'sync_my_data', {
      p_cards: [{ subject: 'Bio', front: 'Zelle', back: 'kleinste Einheit' }],
      p_base_version: 0,
    });
    expect(sync.status).toBeLessThan(300);
    const a = await rpc(A.jwt, 'load_my_data', {});
    expect(a.json.cards).toHaveLength(2);
    const b = await rpc(B.jwt, 'load_my_data', {});
    expect(b.json.cards).toHaveLength(1);
    expect(b.json.cards[0].front).toBe('Zelle');
  });

  it('Fremdzugriff über Tabellen (RLS): B kann As Karten weder lesen noch ändern, löschen oder unterschieben', async () => {
    const read = await api(B.jwt, `/cards?select=id,front&user_id=eq.${A.id}`);
    expect(read.status).toBe(200);
    expect(read.json).toEqual([]);
    const all = await api(B.jwt, '/cards?select=user_id');
    expect(all.json.every((r) => r.user_id === B.id)).toBe(true);

    const patch = await api(B.jwt, `/cards?user_id=eq.${A.id}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ front: 'HACK' }),
    });
    expect([200, 204]).toContain(patch.status);
    expect(patch.json ?? []).toEqual([]);

    const del = await api(B.jwt, `/cards?user_id=eq.${A.id}`, {
      method: 'DELETE',
      headers: { prefer: 'return=representation' },
    });
    expect([200, 204]).toContain(del.status);
    expect(del.json ?? []).toEqual([]);

    const ins = await api(B.jwt, '/cards', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ user_id: A.id, subject: 'X', front: 'unterschoben', back: 'y' }),
    });
    expect(ins.status, ins.text).toBeGreaterThanOrEqual(400);

    const { rows } = await pool.query(
      `select front from cards where user_id = $1 and child_id is null order by front`,
      [A.id]
    );
    expect(rows.map((r) => r.front)).toEqual(['Was ist 7 · 8?', 'to persist']);
  });

  it('Fremdzugriff auf profiles: B sieht nur sich selbst und kann A nicht umbenennen', async () => {
    const list = await api(B.jwt, '/profiles?select=id,email');
    expect(list.status).toBe(200);
    expect(list.json).toEqual([{ id: B.id, email: B.email }]);
    const patch = await api(B.jwt, `/profiles?id=eq.${A.id}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ full_name: 'HACK' }),
    });
    expect(patch.json ?? []).toEqual([]);
    const { rows } = await pool.query('select full_name from profiles where id = $1', [A.id]);
    expect(rows[0].full_name).toBe('Testnutzer');
  });

  it('api_keys: SELECT als Client scheitert auch für den eigenen Key; get_configured_providers nennt nur den Provider', async () => {
    await pool.query(
      `insert into api_keys (user_id, provider, api_key) values ($1, 'claude', 'sk-ant-test-key-0123456789abcdef')
       on conflict (user_id, provider) do update set api_key = excluded.api_key`,
      [A.id]
    );
    const own = await api(A.jwt, '/api_keys?select=provider,api_key');
    expect(own.status).toBe(200);
    expect(own.json).toEqual([]);
    expect(own.text).not.toContain('sk-ant-test-key');
    const anon = await api(null, '/api_keys?select=api_key');
    expect(anon.text).not.toContain('sk-ant-test-key');
    const foreign = await api(B.jwt, `/api_keys?select=api_key&user_id=eq.${A.id}`);
    expect(foreign.json ?? []).toEqual([]);

    const prov = await rpc(A.jwt, 'get_configured_providers', {});
    expect(prov.status).toBe(200);
    expect(prov.json).toEqual([{ provider: 'claude' }]);
    expect((await rpc(B.jwt, 'get_configured_providers', {})).json).toEqual([]);
  });

  it('consume_ai_quota ist über die Data API nicht aufrufbar (weder authenticated noch anonym)', async () => {
    const auth = await rpc(A.jwt, 'consume_ai_quota', { p_user_id: A.id, p_limit: 20 });
    expect(auth.status, auth.text).toBeGreaterThanOrEqual(400);
    expect(typeof auth.json).not.toBe('boolean');
    const anon = await rpc(null, 'consume_ai_quota', { p_user_id: A.id, p_limit: 20 });
    expect(anon.status).toBeGreaterThanOrEqual(400);
    const { rows } = await pool.query(
      'select count(*)::int as n from ai_usage where user_id = $1',
      [A.id]
    );
    expect(rows[0].n).toBe(0);
  });

  it('anonym (ohne JWT) sind load_my_data/sync_my_data nicht ausführbar', async () => {
    expect((await rpc(null, 'load_my_data', {})).status).toBeGreaterThanOrEqual(400);
    expect(
      (await rpc(null, 'sync_my_data', { p_cards: [], p_base_version: 0 })).status
    ).toBeGreaterThanOrEqual(400);
    const { rows } = await pool.query('select count(*)::int as n from cards where user_id = $1', [
      A.id,
    ]);
    expect(rows[0].n).toBe(2);
  });

  it('Neon Auth prüft das Passwort wirklich', async () => {
    expect((await signIn(A.email, 'falsches-Passwort-1')).status).toBeGreaterThanOrEqual(400);
    const ok = await signIn(A.email);
    expect(ok.status).toBe(200);
    expect(ok.cookie).toContain('session_token');
  });

  it('Aufräumen: Testkonten, Profile und Kaskaden sind restlos weg', async () => {
    const left = await cleanupTestUsers(pool);
    expect(left).toEqual({ users: 0, profiles: 0, orphan_cards: 0 });
    const { rows } = await pool.query(
      'select count(*)::int as n from cards where user_id = any($1::uuid[])',
      [[A.id, B.id]]
    );
    expect(rows[0].n).toBe(0);
    // Sitzung des gelöschten Nutzers ist damit ebenfalls wertlos
    const dead = await rpc(A.jwt, 'load_my_data', {});
    expect(dead.status === 200 ? dead.json.cards : []).toEqual([]);
  });
});

// Nur zur Sichtbarkeit im Report, wenn die Umgebung fehlt.
describe.skipIf(hasApi)('Eltern-Persistenz (übersprungen)', () => {
  it.skip(`TEST_DATABASE_URL / TEST_NEON_AUTH_URL / TEST_DATA_API_URL fehlen — API_URL=${API_URL || '-'}`, () => {});
});
