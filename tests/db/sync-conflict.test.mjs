/**
 * Härtung 1.1 — Sync mit Konflikterkennung, über den ECHTEN Produktionspfad
 * (Neon Auth → link-profile → Data API rpc/sync_my_data + rpc/load_my_data)
 * plus das Client-Merge-Modul js/sync-merge.js, das der Browser lädt.
 *
 * Szenario A (zwei Geräte): Sitzung 1 schreibt 50 Karten; Sitzung 2 arbeitet
 * mit dem alten Stand und schreibt eine bewertete Karte → der Server lehnt ab
 * (PT409, nichts wird überschrieben); der Client lädt, führt zusammen und
 * schreibt erneut → alle 51 sind da, die Bewertung bleibt erhalten.
 *
 * Außerdem: alter Client ohne Version wird abgelehnt (PT428), Löschen ersteht
 * nach einem Merge nicht wieder auf, eine fremde Neuanlage verschwindet nicht,
 * Round-Trip-Stabilität der Inhalts-Hashes, Kind-Pfad.
 *
 * Braucht TEST_DATABASE_URL, TEST_NEON_AUTH_URL, TEST_DATA_API_URL (Dev-Branch).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import SBSync from '../../js/sync-merge.js';
import { API_URL, AUTH_URL, DB_URL, hasApi } from './env.mjs';
import {
  anonymousJwt,
  cleanupTestUsers,
  fetchJwt,
  openPool,
  retry,
  rpc,
  signUpUser,
  warmUp,
} from './helpers.mjs';

const uuid = () => crypto.randomUUID();
const card = (front, extra = {}) => ({
  id: uuid(),
  subject: 'Mathe',
  front,
  back: 'Antwort ' + front,
  level: 0,
  due_at: '1970-01-01T00:00:00.000Z',
  ease: 2.5,
  reps: 0,
  interval_days: 0,
  topic: null,
  exam_name: null,
  exam_date: null,
  explain: null,
  ...extra,
});
const rowsOf = (result) => ({
  cards: result.cards.map((r) => ({ ...r.row, id: r.id })),
  tasks: result.tasks.map((r) => ({ ...r.row, id: r.id })),
  exams: result.exams.map((r) => ({ ...r.row, id: r.id })),
});

describe.skipIf(!hasApi)(
  'Härtung 1.1: Konflikterkennung + Merge über die Data API (Dev-Branch)',
  () => {
    let pool;
    let A;
    let CHILD;
    const PIN = 'Pin1234x';

    beforeAll(async () => {
      pool = openPool();
      process.env.DATABASE_URL = DB_URL;
      process.env.NEON_JWKS_URL = `${AUTH_URL}/.well-known/jwks.json`;
      const linkProfile = (await import('../../netlify/functions/link-profile.mjs')).default;
      await warmUp();
      await pool.query('select 1');
      A = await signUpUser('sync', 'Sync Eltern');
      const link = await retry(
        async () => {
          const res = await linkProfile(
            new Request('http://localhost:8888/.netlify/functions/link-profile', {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${A.jwt}` },
              body: JSON.stringify({ full_name: 'Sync Eltern' }),
            })
          );
          return { status: res.status, json: await res.json() };
        },
        (r) => r.status === 401 || r.status >= 500
      );
      expect(link.status, JSON.stringify(link.json)).toBe(200);
      CHILD = (
        await pool.query(
          `insert into children (parent_id, name, grade, pin) values ($1, 'Sync Kind', 6, $2) returning id`,
          [A.id, PIN]
        )
      ).rows[0].id;
    });

    afterAll(async () => {
      if (pool) {
        await cleanupTestUsers(pool);
        await pool.end();
      }
    });

    const load = (jwt) => rpc(jwt, 'load_my_data', {});
    const sync = (jwt, rows, version) =>
      rpc(jwt, 'sync_my_data', {
        p_cards: rows.cards || [],
        p_tasks: rows.tasks || [],
        p_exams: rows.exams || [],
        ...(version === undefined ? {} : { p_base_version: version }),
      });
    const serverCount = async () =>
      (
        await pool.query(
          'select count(*)::int as n from cards where user_id = $1 and child_id is null',
          [A.id]
        )
      ).rows[0].n;

    it('neuer Nutzer: load_my_data liefert version 0 und leere Listen', async () => {
      const r = await load(A.jwt);
      expect(r.status, r.text).toBe(200);
      expect(r.json).toEqual({ version: 0, cards: [], tasks: [], exams: [] });
    });

    it('alter Client (ohne p_base_version): PT428 sync_version_required — Server bleibt leer', async () => {
      const r = await sync(A.jwt, { cards: [card('alt')] });
      expect(r.status, r.text).toBeGreaterThanOrEqual(400);
      expect(r.json).toMatchObject({ code: 'PT428', message: 'sync_version_required' });
      expect(await serverCount()).toBe(0);
      expect((await load(A.jwt)).json.version).toBe(0);
    });

    // Gemeinsamer Ausgangsstand beider „Geräte“: eine Karte X, Version 1
    const X = card('X (gemeinsam)');
    let baseV1;
    let sessionTwoJwt;

    it('Ausgangsstand: Karte X mit Basis 0 → Version 1; beide Sitzungen laden ihn', async () => {
      const r = await sync(A.jwt, { cards: [X] }, 0);
      expect(r.status, r.text).toBe(200);
      expect(r.json).toMatchObject({ ok: true, version: 1 });
      sessionTwoJwt = await fetchJwt(A.cookie); // zweites Gerät = zweite Sitzung
      const l1 = (await load(A.jwt)).json;
      const l2 = (await load(sessionTwoJwt)).json;
      expect(l1.version).toBe(1);
      expect(l2.version).toBe(1);
      expect(l1.cards).toHaveLength(1);
      baseV1 = SBSync.baseFrom(l2); // Basis von Sitzung 2 = Serverstand v1
      expect(Object.keys(baseV1.cards)).toEqual([X.id]);
    });

    const FIFTY = Array.from({ length: 50 }, (_, i) => card(`Laptop-Karte ${i + 1}`));
    const X_RATED = {
      ...X,
      level: 2,
      reps: 1,
      interval_days: 3,
      ease: 2.36,
      due_at: '2026-09-05T12:00:00.000Z',
    };

    it('SZENARIO A: Sitzung 1 schreibt 50 Karten (v1→v2); Sitzung 2 (Basis v1) bewertet X → PT409, Server unverändert (51 statt 1)', async () => {
      const one = await sync(A.jwt, { cards: [X, ...FIFTY] }, 1);
      expect(one.status, one.text).toBe(200);
      expect(one.json).toMatchObject({ ok: true, version: 2 });
      expect(await serverCount()).toBe(51);

      // Tablet: alter Stand (v1), eine Bewertung — vorher hätte dieser Blob 50 Karten gelöscht
      const two = await sync(sessionTwoJwt, { cards: [X_RATED] }, 1);
      expect(two.status, two.text).toBeGreaterThanOrEqual(400);
      expect(two.json).toMatchObject({ code: 'PT409', message: 'sync_conflict' });
      expect(JSON.parse(two.json.details)).toEqual({ server_version: 2, client_version: 1 });
      expect(await serverCount(), 'Konflikt darf nichts überschreiben').toBe(51);
      const still = (await load(sessionTwoJwt)).json;
      expect(still.version).toBe(2);
      expect(still.cards.find((c) => c.id === X.id)).toMatchObject({ level: 0, reps: 0 });
    });

    let baseAfterMerge;
    it('… danach führt der Client zusammen (js/sync-merge.js): 50 fremde Karten + eigene Bewertung → 51, Bewertung bleibt', async () => {
      const server = (await load(sessionTwoJwt)).json;
      const local = { cards: [X_RATED], tasks: [], exams: [] };
      const m = SBSync.merge(local, server, baseV1);
      expect(m.conflicts).toEqual([]);
      expect(m.changed).toBe(true);
      expect(m.cards).toHaveLength(51);
      expect(m.cards.find((r) => r.id === X.id)).toMatchObject({ source: 'local' });
      expect(m.cards.filter((r) => r.source === 'remote')).toHaveLength(50);

      const merged = rowsOf(m);
      const w = await sync(sessionTwoJwt, merged, server.version);
      expect(w.status, w.text).toBe(200);
      expect(w.json).toMatchObject({ ok: true, version: 3 });
      baseAfterMerge = SBSync.baseFrom(merged);

      const after = (await load(A.jwt)).json;
      expect(after.version).toBe(3);
      expect(after.cards).toHaveLength(51);
      expect(after.cards.find((c) => c.id === X.id)).toMatchObject({
        level: 2,
        reps: 1,
        interval_days: 3,
      });
      expect(Number(after.cards.find((c) => c.id === X.id).ease)).toBe(2.36);
      expect(after.cards.map((c) => c.front).filter((f) => f.startsWith('Laptop'))).toHaveLength(
        50
      );
    });

    it('Löschen ersteht nicht wieder auf; fremde Neuanlage verschwindet nicht', async () => {
      // Sitzung 1 legt Z an (v3→v4) …
      const Z = card('Z (fremde Neuanlage)');
      const server3 = (await load(A.jwt)).json;
      const s1 = await sync(A.jwt, { cards: [...server3.cards, Z] }, 3);
      expect(s1.json).toMatchObject({ ok: true, version: 4 });

      // … Sitzung 2 löscht derweil Y (eine der 50) auf Basis v3 → Konflikt → Merge
      const Y = FIFTY[7];
      const localCards = rowsOf(
        SBSync.merge({ cards: [X_RATED], tasks: [], exams: [] }, server3, baseV1)
      ).cards.filter((c) => c.id !== Y.id);
      expect(localCards).toHaveLength(50);
      const rejected = await sync(sessionTwoJwt, { cards: localCards }, 3);
      expect(rejected.json).toMatchObject({ code: 'PT409' });

      const server4 = (await load(sessionTwoJwt)).json;
      expect(server4.version).toBe(4);
      const m = SBSync.merge({ cards: localCards, tasks: [], exams: [] }, server4, baseAfterMerge);
      expect(m.conflicts).toEqual([]);
      const ids = m.cards.map((r) => r.id);
      expect(ids, 'Y bleibt gelöscht').not.toContain(Y.id);
      expect(ids, 'Z bleibt erhalten').toContain(Z.id);
      expect(m.cards).toHaveLength(51);
      const w = await sync(sessionTwoJwt, rowsOf(m), 4);
      expect(w.json).toMatchObject({ ok: true, version: 5 });

      const final = (await load(A.jwt)).json;
      expect(final.cards.map((c) => c.id)).not.toContain(Y.id);
      expect(final.cards.map((c) => c.id)).toContain(Z.id);
      expect(final.cards).toHaveLength(51);
      expect(await serverCount()).toBe(51);
    });

    it('Round-Trip-Stabilität: Hash der gesendeten Zeile == Hash der geladenen Zeile (Karte, Aufgabe, Prüfung)', async () => {
      const full = card('Vollständig', {
        level: 3,
        due_at: '2026-10-01T08:30:00.000Z',
        ease: 2.36,
        reps: 4,
        interval_days: 7,
        topic: 'Brüche',
        exam_name: 'Klassenarbeit 2',
        exam_date: '2026-10-15',
        explain: 'Weil …',
      });
      const task = {
        id: uuid(),
        title: 'Lesen',
        subject: 'Deutsch',
        due_at: '2026-09-20',
        completed: true,
      };
      const exam = {
        id: uuid(),
        subject: 'Mathe',
        score: 7,
        total: 10,
        created_at: '2026-09-01T10:00:00.000Z',
      };
      const before = (await load(A.jwt)).json;
      const w = await sync(
        A.jwt,
        { cards: [...before.cards, full], tasks: [task], exams: [exam] },
        before.version
      );
      expect(w.status, w.text).toBe(200);
      const after = (await load(A.jwt)).json;
      const sc = after.cards.find((c) => c.id === full.id);
      expect(SBSync.rowHash('cards', sc)).toBe(SBSync.rowHash('cards', full));
      expect(
        SBSync.rowHash(
          'tasks',
          after.tasks.find((t) => t.id === task.id)
        )
      ).toBe(SBSync.rowHash('tasks', task));
      expect(
        SBSync.rowHash(
          'exams',
          after.exams.find((e) => e.id === exam.id)
        )
      ).toBe(SBSync.rowHash('exams', exam));
      // und unveränderte Zeilen erzeugen beim Merge keinerlei Änderung
      const m = SBSync.merge(after, after, SBSync.baseFrom(after));
      expect(m.changed).toBe(false);
      expect(m.conflicts).toEqual([]);
    });

    it('Kind-Pfad (anonym, PIN): veraltete Version → PT409, ohne Version → PT428, load liefert version', async () => {
      const anon = await anonymousJwt();
      const child = (rows, version) =>
        rpc(anon, 'sync_child_data', {
          p_child_id: CHILD,
          p_pin: PIN,
          p_cards: rows,
          ...(version === undefined ? {} : { p_base_version: version }),
        });
      const l0 = await rpc(anon, 'load_child_data', { p_child_id: CHILD, p_pin: PIN });
      expect(l0.status, l0.text).toBe(200);
      expect(l0.json.version).toBe(0);
      const old = await child([card('kind alt')]);
      expect(old.json).toMatchObject({ code: 'PT428' });
      const ok = await child([card('kind 1')], 0);
      expect(ok.status, ok.text).toBe(200);
      expect(ok.json).toMatchObject({ ok: true, version: 1 });
      const stale = await child([card('kind 2')], 0);
      expect(stale.json).toMatchObject({ code: 'PT409' });
      const l1 = await rpc(anon, 'load_child_data', { p_child_id: CHILD, p_pin: PIN });
      expect(l1.json.version).toBe(1);
      expect(l1.json.cards.map((c) => c.front)).toEqual(['kind 1']);
      const pin = await rpc(anon, 'sync_child_data', {
        p_child_id: CHILD,
        p_pin: 'falsch',
        p_cards: [],
        p_base_version: 1,
      });
      expect(pin.json).toEqual({ ok: false, error: 'pin' });
    });

    it('Aufräumen: Testkonto, Kind, Karten und sync_state sind restlos weg', async () => {
      const left = await cleanupTestUsers(pool);
      expect(left).toEqual({ users: 0, profiles: 0, orphan_cards: 0 });
      await pool.query('delete from sync_state where scope_id = any($1::uuid[])', [[A.id, CHILD]]);
      const { rows } = await pool.query(
        'select (select count(*)::int from cards where user_id = $1) as cards, (select count(*)::int from sync_state where scope_id = any($2::uuid[])) as state',
        [A.id, [A.id, CHILD]]
      );
      expect(rows[0]).toEqual({ cards: 0, state: 0 });
    });
  }
);

describe.skipIf(hasApi)('Härtung 1.1 Konflikterkennung (übersprungen)', () => {
  it.skip(`TEST_DATABASE_URL / TEST_NEON_AUTH_URL / TEST_DATA_API_URL fehlen — API_URL=${API_URL || '-'}`, () => {});
});
