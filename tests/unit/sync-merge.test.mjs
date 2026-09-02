/**
 * Merge-Regeln von js/sync-merge.js (Härtung 1.1) — reine Logik, kein Netz.
 * Jede Regel aus dem Kopfkommentar des Moduls hat hier einen Fall; die
 * Datenverlust-Szenarien A/B stehen zusätzlich als DB-/E2E-Tests.
 */
import { describe, expect, it } from 'vitest';
import SBSync from '../../js/sync-merge.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const card = (n, extra = {}) => ({
  id: id(n),
  subject: 'Mathe',
  front: `Frage ${n}`,
  back: `Antwort ${n}`,
  level: 0,
  due_at: '1970-01-01T00:00:00.000Z',
  ease: 2.5,
  reps: 0,
  interval_days: 0,
  ...extra,
});
const set = (cards) => ({ cards, tasks: [], exams: [] });
const ids = (m) => m.cards.map((r) => r.id).sort();

describe('Hash und kanonische Form', () => {
  it('ist deterministisch und unterscheidet Inhalte', () => {
    expect(SBSync.hash('abc')).toBe(SBSync.hash('abc'));
    expect(SBSync.hash('abc')).not.toBe(SBSync.hash('abd'));
    expect(SBSync.rowHash('cards', card(1))).toBe(SBSync.rowHash('cards', card(1)));
    expect(SBSync.rowHash('cards', card(1))).not.toBe(
      SBSync.rowHash('cards', card(1, { back: 'x' }))
    );
  });

  it('Client-Zeile und Server-Zeile derselben Karte ergeben denselben Hash (Zahl/String, Zeitformat, Metadaten)', () => {
    const client = card(1, {
      ease: 2.36,
      due_at: '2026-09-05T12:00:00.000Z',
      topic: null,
      exam_date: null,
    });
    const server = {
      ...card(1),
      ease: '2.36',
      due_at: '2026-09-05T12:00:00+00:00',
      topic: null,
      exam_date: null,
      updated_at: '2026-09-02T10:00:00.123456+00:00',
      created_at: '2026-09-01T10:00:00+00:00',
    };
    expect(SBSync.rowHash('cards', client)).toBe(SBSync.rowHash('cards', server));
    expect(SBSync.rowHash('tasks', { title: 'A', subject: '', due_at: null, completed: 0 })).toBe(
      SBSync.rowHash('tasks', {
        title: 'A',
        subject: null,
        due_at: null,
        completed: false,
        updated_at: 'x',
      })
    );
    expect(
      SBSync.rowHash('exams', {
        subject: 'M',
        score: 7,
        total: 10,
        created_at: '2026-09-01T10:00:00.000Z',
      })
    ).toBe(
      SBSync.rowHash('exams', {
        subject: 'M',
        score: '7',
        total: '10',
        created_at: '2026-09-01T10:00:00+00:00',
      })
    );
  });

  it('baseFrom nimmt nur UUID-ids auf', () => {
    const b = SBSync.baseFrom(set([card(1), { ...card(2), id: 'c1727000000' }]));
    expect(Object.keys(b.cards)).toEqual([id(1)]);
  });
});

describe('Merge-Regeln (mit Basis)', () => {
  it('SZENARIO A: 50 fremde neue Karten + eine lokal bewertete → 51, Bewertung bleibt, kein Konflikt', () => {
    const X = card(1);
    const fifty = Array.from({ length: 50 }, (_, i) => card(100 + i));
    const base = SBSync.baseFrom(set([X]));
    const local = set([{ ...X, level: 2, reps: 1 }]);
    const server = set([X, ...fifty]);
    const m = SBSync.merge(local, server, base);
    expect(m.conflicts).toEqual([]);
    expect(m.changed).toBe(true);
    expect(m.cards).toHaveLength(51);
    expect(m.cards.find((r) => r.id === X.id)).toMatchObject({ source: 'local', row: { reps: 1 } });
  });

  it('unverändert auf beiden Seiten → Serverstand, changed=false', () => {
    const s = set([card(1), card(2)]);
    const m = SBSync.merge(s, s, SBSync.baseFrom(s));
    expect(m.changed).toBe(false);
    expect(m.cards.every((r) => r.source === 'remote')).toBe(true);
  });

  it('lokal gelöscht, Server kennt die Karte noch → bleibt gelöscht (Löschen ersteht nicht wieder auf)', () => {
    const base = SBSync.baseFrom(set([card(1), card(2)]));
    const m = SBSync.merge(set([card(1)]), set([card(1), card(2)]), base);
    expect(ids(m)).toEqual([id(1)]);
    expect(m.changed).toBe(true);
    expect(m.conflicts).toEqual([]);
  });

  it('lokal gelöscht UND fremde Neuanlage → Löschung bleibt, Neuanlage bleibt', () => {
    const base = SBSync.baseFrom(set([card(1), card(2)]));
    const m = SBSync.merge(set([card(1)]), set([card(1), card(2), card(3)]), base);
    expect(ids(m)).toEqual([id(1), id(3)]);
  });

  it('auf dem Server gelöscht, lokal unverändert → lokal entfernt, nichts zu schreiben', () => {
    const base = SBSync.baseFrom(set([card(1), card(2)]));
    const m = SBSync.merge(set([card(1), card(2)]), set([card(1)]), base);
    expect(ids(m)).toEqual([id(1)]);
    expect(m.changed).toBe(false);
  });

  it('fremde Neuanlage bei lokal unverändertem Stand → übernommen, nichts zu schreiben', () => {
    const base = SBSync.baseFrom(set([card(1)]));
    const m = SBSync.merge(set([card(1)]), set([card(1), card(9)]), base);
    expect(ids(m)).toEqual([id(1), id(9)]);
    expect(m.changed).toBe(false);
  });

  it('lokal neu (nicht in Basis, nicht auf Server) → bleibt, changed=true', () => {
    const base = SBSync.baseFrom(set([card(1)]));
    const m = SBSync.merge(set([card(1), card(5)]), set([card(1)]), base);
    expect(ids(m)).toEqual([id(1), id(5)]);
    expect(m.changed).toBe(true);
  });

  it('beidseitig gleich geändert → Serverstand, kein Konflikt, nichts zu schreiben', () => {
    const base = SBSync.baseFrom(set([card(1)]));
    const edited = card(1, { back: 'neu' });
    const m = SBSync.merge(set([edited]), set([edited]), base);
    expect(m.conflicts).toEqual([]);
    expect(m.changed).toBe(false);
  });

  it('beidseitig verschieden geändert → Konflikt mit Vorwahl; Karten: mehr Wiederholungen gewinnen', () => {
    const base = SBSync.baseFrom(set([card(1)]));
    const local = card(1, { reps: 3, level: 2 });
    const remote = card(1, { back: 'Server-Text' });
    const m = SBSync.merge(set([local]), set([remote]), base);
    expect(m.conflicts).toHaveLength(1);
    expect(m.conflicts[0]).toMatchObject({ type: 'cards', id: id(1), choice: 'local' });
    expect(m.cards[0]).toMatchObject({ source: 'local', row: { reps: 3 } });
    // ohne Lernfortschritt-Vorsprung: Server als Vorwahl
    const m2 = SBSync.merge(set([card(1, { back: 'lokal' })]), set([remote]), base);
    expect(m2.conflicts[0].choice).toBe('remote');
  });

  it('Löschen gegen Bearbeiten → Konflikt, Vorwahl behält die bearbeitete Fassung', () => {
    const base = SBSync.baseFrom(set([card(1)]));
    const m = SBSync.merge(set([]), set([card(1, { back: 'anderswo bearbeitet' })]), base);
    expect(m.conflicts).toEqual([
      expect.objectContaining({ id: id(1), local: null, choice: 'remote' }),
    ]);
    expect(ids(m)).toEqual([id(1)]);
    const m2 = SBSync.merge(set([card(1, { reps: 2 })]), set([]), base);
    expect(m2.conflicts).toEqual([
      expect.objectContaining({ id: id(1), remote: null, choice: 'local' }),
    ]);
    expect(ids(m2)).toEqual([id(1)]);
    expect(m2.changed).toBe(true);
  });

  it('applyChoices setzt die Nutzerentscheidung um (auch Löschung) und bestimmt changed neu', () => {
    const base = SBSync.baseFrom(set([card(1), card(2)]));
    const server = set([card(1, { back: 'S1' }), card(2, { back: 'S2' })]);
    const m = SBSync.merge(set([card(1, { back: 'L1' })]), server, base);
    expect(m.conflicts.map((c) => c.id).sort()).toEqual([id(1), id(2)]);
    SBSync.applyChoices(m, { [id(1)]: 'remote', [id(2)]: 'local' }); // 1: Server, 2: Löschung bestätigen
    expect(m.cards).toEqual([{ id: id(1), source: 'remote', row: server.cards[0] }]);
    expect(m.changed).toBe(true);
    SBSync.applyChoices(m, { [id(1)]: 'remote', [id(2)]: 'remote' });
    expect(ids(m)).toEqual([id(1), id(2)]);
    expect(m.changed).toBe(false);
  });

  it('lokale Zeile ohne id wird als neu behalten', () => {
    const m = SBSync.merge(set([{ ...card(1), id: undefined }]), set([]), SBSync.baseFrom(set([])));
    expect(m.cards).toHaveLength(1);
    expect(m.changed).toBe(true);
  });

  it('Aufgaben und Prüfungen folgen denselben Regeln', () => {
    const t = (n, extra = {}) => ({
      id: id(n),
      title: 'T' + n,
      subject: null,
      due_at: null,
      completed: false,
      ...extra,
    });
    const base = SBSync.baseFrom({ cards: [], tasks: [t(1), t(2)], exams: [] });
    const m = SBSync.merge(
      { cards: [], tasks: [t(1, { completed: true })], exams: [] }, // 1 erledigt, 2 gelöscht
      { cards: [], tasks: [t(1), t(2), t(3)], exams: [] }, // 3 anderswo neu
      base
    );
    expect(m.tasks.map((r) => r.id).sort()).toEqual([id(1), id(3)]);
    expect(m.tasks.find((r) => r.id === id(1)).row.completed).toBe(true);
    expect(m.changed).toBe(true);
  });
});

describe('Ohne Basis (Erstlauf / neues Gerät / Client vor 1.1)', () => {
  it('Vereinigung: lokal Neues bleibt, Server-Neues kommt dazu, nichts wird gelöscht', () => {
    const m = SBSync.merge(set([card(1), card(2)]), set([card(2), card(3)]), null);
    expect(ids(m)).toEqual([id(1), id(2), id(3)]);
    expect(m.hasBase).toBe(false);
    expect(m.conflicts).toEqual([]);
    expect(m.changed).toBe(true);
  });

  it('gleiche id, verschiedener Inhalt → Server gewinnt (bisheriges Verhalten), kein Konflikt', () => {
    const m = SBSync.merge(
      set([card(1, { back: 'lokal' })]),
      set([card(1, { back: 'server' })]),
      null
    );
    expect(m.cards[0]).toMatchObject({ source: 'remote', row: { back: 'server' } });
    expect(m.changed).toBe(false);
  });

  it('leerer lokaler Stand (frisches Gerät) → alles vom Server, nichts zu schreiben', () => {
    const m = SBSync.merge(set([]), set([card(1), card(2)]), null);
    expect(ids(m)).toEqual([id(1), id(2)]);
    expect(m.changed).toBe(false);
  });
});
