/**
 * SQL-/RLS-Struktur- und Rollen-Tests gegen einen Neon-Dev-Branch.
 * Braucht nur TEST_DATABASE_URL (Owner). Alles läuft in Transaktionen, die
 * zurückgerollt werden — der Branch bleibt unverändert.
 *
 * Der Test „load_my_data als authenticated → 'not authenticated' statt 42501“
 * ist die SQL-Fassung des Sieben-Wochen-Ausfalls: Ohne SECURITY DEFINER lief
 * die Funktion als Rolle authenticated, die kein USAGE auf Schema auth hat, und
 * scheiterte mit 42501 „permission denied for schema auth“.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasDb } from './env.mjs';
import { asRole, inRolledBackTx, openPool, pgError, testEmail } from './helpers.mjs';

const SECDEF_QUERY = `
  select p.proname as fn, p.proconfig as config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
  order by p.proname`;

describe.skipIf(!hasDb)('Struktur: SECURITY DEFINER, Rechte, RLS', () => {
  let pool;
  beforeAll(() => {
    pool = openPool();
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('keine SECURITY-DEFINER-Funktion in public ohne search_path = public, pg_temp', async () => {
    const { rows } = await pool.query(SECDEF_QUERY);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const offenders = rows
      .filter((r) => !(r.config ?? []).includes('search_path=public, pg_temp'))
      .map((r) => `${r.fn}: ${JSON.stringify(r.config)}`);
    expect(offenders, 'Funktionen ohne festgenagelten search_path').toEqual([]);
  });

  it('load_my_data und sync_my_data sind SECURITY DEFINER und nur für authenticated ausführbar', async () => {
    const { rows } = await pool.query(SECDEF_QUERY);
    const names = rows.map((r) => r.fn);
    expect(names).toContain('load_my_data');
    expect(names).toContain('sync_my_data');
    const priv = async (role, fn) =>
      (await pool.query(`select has_function_privilege($1, $2, 'EXECUTE') as ok`, [role, fn]))
        .rows[0].ok;
    expect(await priv('authenticated', 'public.load_my_data()')).toBe(true);
    expect(await priv('authenticated', 'public.sync_my_data(jsonb,jsonb,jsonb,bigint)')).toBe(true);
    expect(await priv('anonymous', 'public.load_my_data()')).toBe(false);
    expect(await priv('anonymous', 'public.sync_my_data(jsonb,jsonb,jsonb,bigint)')).toBe(false);
  });

  it('authenticated hat bewusst kein USAGE auf Schema auth (siehe neon/migrations/004)', async () => {
    const { rows } = await pool.query(
      `select has_schema_privilege('authenticated','auth','USAGE') as a,
              has_schema_privilege('anonymous','auth','USAGE') as b`
    );
    expect(rows[0]).toEqual({ a: false, b: false });
    await inRolledBackTx(pool, async (c) => {
      const err = await asRole(c, 'authenticated', () => pgError(c.query('select auth.uid()')));
      expect(err?.code).toBe('42501');
    });
  });

  it('Sieben-Wochen-Test (SQL): load_my_data/sync_my_data als authenticated laufen bis zur Auth-Prüfung, statt an 42501 zu scheitern', async () => {
    await inRolledBackTx(pool, async (c) => {
      const load = await asRole(c, 'authenticated', () =>
        pgError(c.query('select load_my_data()'))
      );
      // Ohne JWT-Session ist auth.uid() NULL → die Funktion selbst wirft 'not authenticated'
      // (P0001). Wäre sie SECURITY INVOKER, käme 42501 „permission denied for schema auth“.
      expect(load?.code, load?.message).toBe('P0001');
      expect(load?.message).toMatch(/not authenticated/);
      const sync = await asRole(c, 'authenticated', () =>
        pgError(c.query(`select sync_my_data('[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0)`))
      );
      expect(sync?.code, sync?.message).toBe('P0001');
      expect(sync?.message).toMatch(/not authenticated/);
    });
  });

  it('consume_ai_quota: nur neondb_owner darf ausführen (authenticated/anonymous → 42501)', async () => {
    const { rows } = await pool.query(
      `select has_function_privilege('authenticated','public.consume_ai_quota(uuid,integer)','EXECUTE') as a,
              has_function_privilege('anonymous','public.consume_ai_quota(uuid,integer)','EXECUTE') as b,
              has_function_privilege('neondb_owner','public.consume_ai_quota(uuid,integer)','EXECUTE') as o`
    );
    expect(rows[0]).toEqual({ a: false, b: false, o: true });
    await inRolledBackTx(pool, async (c) => {
      const uid = (await c.query('select gen_random_uuid() as u')).rows[0].u;
      for (const role of ['authenticated', 'anonymous']) {
        const err = await asRole(c, role, () =>
          pgError(c.query('select consume_ai_quota($1::uuid, 20)', [uid]))
        );
        expect(err?.code, role).toBe('42501');
      }
    });
  });

  it('api_keys: keine SELECT-/ALL-Policy (Maßnahme 0.2), RLS auf allen Nutzertabellen aktiv', async () => {
    const pol = await pool.query(
      `select policyname, cmd from pg_policies where schemaname='public' and tablename='api_keys'`
    );
    const cmds = pol.rows.map((r) => r.cmd);
    expect(cmds).not.toContain('SELECT');
    expect(cmds).not.toContain('ALL');
    expect(cmds.sort()).toEqual(['DELETE', 'INSERT', 'UPDATE']);
    const rls = await pool.query(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'
          and relname in ('profiles','children','cards','tasks','exams','api_keys','user_stats','sessions','ai_usage')`
    );
    expect(rls.rows).toHaveLength(9);
    expect(rls.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it('ohne JWT-Session sieht die Client-Rolle keine einzige Nutzerzeile', async () => {
    await inRolledBackTx(pool, async (c) => {
      const owner = (await c.query('select count(*)::int as n from profiles')).rows[0].n;
      expect(owner).toBeGreaterThan(0);
      for (const role of ['authenticated', 'anonymous']) {
        const seen = await asRole(c, role, async () => {
          const q = async (t) => (await c.query(`select count(*)::int as n from ${t}`)).rows[0].n;
          return {
            profiles: await q('profiles'),
            cards: await q('cards'),
            api_keys: await q('api_keys'),
          };
        });
        expect(seen, role).toEqual({ profiles: 0, cards: 0, api_keys: 0 });
      }
    });
  });
});

describe.skipIf(!hasDb)('Kind-Pfad: auth_child, sync_child_data, load_child_data', () => {
  let pool;
  beforeAll(() => {
    pool = openPool();
  });
  afterAll(async () => {
    await pool?.end();
  });

  const PIN_A = 'KindApin1';
  const PIN_B = 'KindBpin2';

  /** Legt Elternteil + zwei Kinder an (nur innerhalb der Transaktion). */
  async function seed(c) {
    const email = testEmail('child');
    const parent = (
      await c.query(
        `insert into profiles (id, email, full_name, role) values (gen_random_uuid(), $1, 'Test-Eltern', 'parent') returning id`,
        [email]
      )
    ).rows[0].id;
    const mk = async (name, pin) =>
      (
        await c.query(
          `insert into children (parent_id, name, grade, pin) values ($1, $2, 7, $3) returning id`,
          [parent, name, pin]
        )
      ).rows[0].id;
    return { email, parent, childA: await mk('Kind A', PIN_A), childB: await mk('Kind B', PIN_B) };
  }

  it('auth_child: falscher PIN und unbekannte E-Mail werden abgelehnt, richtiger PIN liefert das Kind', async () => {
    await inRolledBackTx(pool, async (c) => {
      const s = await seed(c);
      const call = (email, pin) =>
        c.query('select auth_child($1, $2) as r', [email, pin]).then((r) => r.rows[0].r);
      await asRole(c, 'anonymous', async () => {
        expect(await call(s.email, 'FalschPin9')).toEqual({ error: expect.stringMatching(/PIN/) });
        expect(await call(s.email, PIN_B.toLowerCase())).toEqual({
          error: expect.stringMatching(/PIN/),
        });
        expect(await call(s.email, '')).toEqual({ error: expect.stringMatching(/PIN/) });
        expect(await call('niemand@' + s.email.split('@')[1], PIN_A)).toEqual({
          error: expect.stringMatching(/nicht gefunden/),
        });
        const ok = await call(s.email.toUpperCase(), PIN_A);
        expect(ok.child_id).toBe(s.childA);
        expect(ok).not.toHaveProperty('pin');
        expect(ok).not.toHaveProperty('error');
      });
    });
  });

  it('sync_child_data/load_child_data bleiben auf das eigene Kind begrenzt', async () => {
    await inRolledBackTx(pool, async (c) => {
      const s = await seed(c);
      const cards = JSON.stringify([{ subject: 'Mathe', front: 'Frage A', back: 'Antwort A' }]);
      await asRole(c, 'anonymous', async () => {
        // Kind-B-PIN gegen Kind A: nichts schreiben, nichts lesen
        const wrongSync = await c.query(
          'select sync_child_data($1::uuid, $2, $3::jsonb, p_base_version => 0) as ok',
          [s.childA, PIN_B, cards]
        );
        expect(wrongSync.rows[0].ok).toEqual({ ok: false, error: 'pin' });
        const wrongLoad = await c.query('select load_child_data($1::uuid, $2) as r', [
          s.childA,
          PIN_B,
        ]);
        expect(wrongLoad.rows[0].r).toEqual({ error: 'pin' });
        const wrongStats = await c.query(
          `select update_child_stats($1::uuid, $2, 999, 9, 9, 9, '[0,0,0,0,0,0,0]'::jsonb) as ok`,
          [s.childA, PIN_B]
        );
        expect(wrongStats.rows[0].ok).toBe(false);

        // Richtiger PIN: Roundtrip für Kind A, Kind B bleibt leer
        const okSync = await c.query(
          'select sync_child_data($1::uuid, $2, $3::jsonb, p_base_version => 0) as ok',
          [s.childA, PIN_A, cards]
        );
        expect(okSync.rows[0].ok).toMatchObject({ ok: true, version: 1 });
        const loadA = (
          await c.query('select load_child_data($1::uuid, $2) as r', [s.childA, PIN_A])
        ).rows[0].r;
        expect(loadA.cards).toHaveLength(1);
        expect(loadA.cards[0]).toMatchObject({
          subject: 'Mathe',
          front: 'Frage A',
          back: 'Antwort A',
        });
        const loadB = (
          await c.query('select load_child_data($1::uuid, $2) as r', [s.childB, PIN_B])
        ).rows[0].r;
        expect(loadB.cards).toEqual([]);
      });
      // Als Owner: die Karte hängt am Elternteil und an Kind A — nirgends sonst
      const rows = (
        await c.query('select user_id, child_id from cards where child_id in ($1, $2)', [
          s.childA,
          s.childB,
        ])
      ).rows;
      expect(rows).toEqual([{ user_id: s.parent, child_id: s.childA }]);
      expect(
        (await c.query('select count(*)::int as n from cards where child_id = $1', [s.childB]))
          .rows[0].n
      ).toBe(0);
    });
  });
  it('1.1 Versionierung (SQL): ohne p_base_version → PT428, veraltete Version → PT409 — beides ohne Schreibzugriff', async () => {
    await inRolledBackTx(pool, async (c) => {
      const s = await seed(c);
      const one = JSON.stringify([{ subject: 'Mathe', front: 'v1', back: 'a' }]);
      const two = JSON.stringify([
        { subject: 'Mathe', front: 'v1', back: 'a' },
        { subject: 'Mathe', front: 'v2', back: 'b' },
      ]);
      const count = async () =>
        (await c.query('select count(*)::int as n from cards where child_id = $1', [s.childA]))
          .rows[0].n;
      // Jeder erwartete Fehler in einem eigenen Rollenblock (Savepoint), sonst ist die
      // Transaktion abgebrochen.
      const anon = (fn) => asRole(c, 'anonymous', fn);
      const call = (json, version) =>
        c
          .query('select sync_child_data($1::uuid, $2, $3::jsonb, p_base_version => $4) as r', [
            s.childA,
            PIN_A,
            json,
            version,
          ])
          .then((r) => r.rows[0].r);

      // alter Client (keine Version): abgelehnt, Server unverändert
      const old = await anon(() =>
        pgError(c.query('select sync_child_data($1::uuid, $2, $3::jsonb)', [s.childA, PIN_A, one]))
      );
      expect(old?.code, old?.message).toBe('PT428');
      expect(old?.message).toBe('sync_version_required');
      expect(await count()).toBe(0);

      // erster echter Sync mit Basis 0 → Version 1
      expect(await anon(() => call(one, 0))).toMatchObject({ ok: true, version: 1 });
      expect(await count()).toBe(1);

      // zweites Gerät mit veralteter Basis 0 → Konflikt, Server bleibt bei 1 Karte / Version 1
      const stale = await anon(() => pgError(call(two, 0)));
      expect(stale?.code, stale?.message).toBe('PT409');
      expect(stale?.message).toBe('sync_conflict');
      expect(JSON.parse(stale.detail || '{}')).toEqual({ server_version: 1, client_version: 0 });
      expect(await count()).toBe(1);
      const load = await anon(() =>
        c
          .query('select load_child_data($1::uuid, $2) as r', [s.childA, PIN_A])
          .then((r) => r.rows[0].r)
      );
      expect(load.version).toBe(1);
      expect(load.cards[0]).toHaveProperty('updated_at');

      // mit der richtigen Basis klappt es → Version 2
      expect(await anon(() => call(two, 1))).toMatchObject({ ok: true, version: 2 });
      expect(await count()).toBe(2);
      const st = await c.query('select data_version from sync_state where scope_id = $1', [
        s.childA,
      ]);
      expect(st.rows[0].data_version).toBe('2');
    });
  });

  it('1.1 Upsert stempelt updated_at nur bei Inhaltsänderung und lässt fremde ids unangetastet', async () => {
    await inRolledBackTx(pool, async (c) => {
      const s = await seed(c);
      const id = (await c.query('select gen_random_uuid() as u')).rows[0].u;
      const row = (front) => JSON.stringify([{ id, subject: 'Mathe', front, back: 'a' }]);
      await asRole(c, 'anonymous', async () => {
        await c.query('select sync_child_data($1::uuid, $2, $3::jsonb, p_base_version => 0)', [
          s.childA,
          PIN_A,
          row('gleich'),
        ]);
      });
      const t1 = (await c.query('select updated_at from cards where id = $1', [id])).rows[0]
        .updated_at;
      await c.query(`select pg_sleep(0.05)`);
      await asRole(c, 'anonymous', async () => {
        await c.query('select sync_child_data($1::uuid, $2, $3::jsonb, p_base_version => 1)', [
          s.childA,
          PIN_A,
          row('gleich'),
        ]);
      });
      const t2 = (await c.query('select updated_at from cards where id = $1', [id])).rows[0]
        .updated_at;
      expect(t2.getTime(), 'unveränderter Inhalt → updated_at bleibt').toBe(t1.getTime());
      await asRole(c, 'anonymous', async () => {
        await c.query('select sync_child_data($1::uuid, $2, $3::jsonb, p_base_version => 2)', [
          s.childA,
          PIN_A,
          row('anders'),
        ]);
      });
      const t3 = (await c.query('select updated_at from cards where id = $1', [id])).rows[0]
        .updated_at;
      expect(t3.getTime(), 'geänderter Inhalt → neuer Stempel').toBeGreaterThan(t1.getTime());

      // Kind B schiebt die id von Kind A unter: weder verändert noch übernommen
      await asRole(c, 'anonymous', async () => {
        const r = (
          await c.query(
            'select sync_child_data($1::uuid, $2, $3::jsonb, p_base_version => 0) as r',
            [s.childB, PIN_B, JSON.stringify([{ id, subject: 'X', front: 'HACK', back: 'y' }])]
          )
        ).rows[0].r;
        expect(r).toMatchObject({ ok: true });
      });
      const rows = (await c.query('select child_id, front from cards where id = $1', [id])).rows;
      expect(rows).toEqual([{ child_id: s.childA, front: 'anders' }]);
    });
  });

  it('1.1 sync_state ist für Client-Rollen unsichtbar', async () => {
    const { rows } = await pool.query(
      `select has_table_privilege('authenticated','public.sync_state','SELECT') as a,
              has_table_privilege('anonymous','public.sync_state','SELECT') as b,
              (select relrowsecurity from pg_class where oid = 'public.sync_state'::regclass) as rls`
    );
    expect(rows[0]).toEqual({ a: false, b: false, rls: true });
  });
});
