/**
 * StudyBuddy — Sync-Zusammenführung (Härtung 1.1)
 *
 * Reines Modul ohne DOM: läuft im Browser (window.SBSync) und in Node/Vitest
 * (module.exports). Der Client führt Karten/Aufgaben/Prüfungen PRO ENTITÄT
 * zusammen, statt den Cloud-Stand blind zu ersetzen.
 *
 * Grundidee: Drei-Wege-Merge gegen den letzten Sync-Stand („Basis“).
 *   - Basis = Inhalts-Hash je Entität (id → hash) des Standes, den Client und
 *     Server zuletzt nachweislich gemeinsam hatten (nach erfolgreichem Laden =
 *     Serverstand; nach erfolgreichem Schreiben = gesendeter Stand).
 *   - Änderungserkennung über Inhalts-Hashes, NICHT über Zeitstempel: Geräteuhren
 *     spielen keine Rolle. updated_at (serverseitig gestempelt) dient nur der
 *     Anzeige im Konfliktdialog.
 *
 * Merge-Regeln je Entität (id = UUID, l = lokal, s = Server, b = Basis-Hash):
 *   1. Auf keiner Seite geändert          → Serverstand (identisch).
 *   2. Nur lokal geändert                 → lokal gewinnt. Lokal gelöscht (in
 *      Basis, lokal fehlt) → bleibt gelöscht — ein Löschen ersteht nicht wieder auf.
 *   3. Nur auf dem Server geändert        → Server gewinnt. Auf dem Server neu
 *      (nicht in Basis) → wird übernommen — eine fremde Neuanlage verschwindet nie.
 *      Auf dem Server gelöscht → wird lokal entfernt.
 *   4. Beidseitig geändert, gleicher Inhalt → Serverstand (kein Konflikt).
 *   5. Beidseitig geändert, verschieden   → KONFLIKT: wird gemeldet und dem
 *      Nutzer gezeigt (conflicts[]). Vorläufige Wahl (choice):
 *        - eine Seite gelöscht, andere bearbeitet → die bearbeitete Fassung
 *          (Inhalt geht nie still verloren; der Nutzer kann Löschen bestätigen)
 *        - beide bearbeitet: Karten → die Fassung mit mehr Wiederholungen
 *          (reps, Lernfortschritt), sonst Server; Aufgaben/Prüfungen → Server.
 *   Ohne Basis (Erstlauf, neues Gerät, Client vor 1.1): Vereinigung. Lokal
 *   Neues bleibt, Server-Neues kommt dazu, bei gleicher id gewinnt der Server
 *   (das bisherige Verhalten) — gelöscht wird nichts, weil ohne Basis nicht
 *   entscheidbar ist, ob eine Zeile gelöscht oder anderswo neu angelegt wurde.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SBSync = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const TYPES = ['cards', 'tasks', 'exams'];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** 53-Bit-String-Hash (cyrb53, public domain) — deterministisch, schnell, kollisionsarm. */
  function hash(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }

  const str = (v) => (v == null ? '' : String(v));
  const opt = (v) => (v == null || v === '' ? null : String(v));
  const int = (v, d = 0) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  };
  const ms = (v) => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : 0;
  };
  const dateOnly = (v) => {
    if (v == null || v === '') return null;
    const s = String(v);
    return s.length >= 10 ? s.slice(0, 10) : s;
  };

  /**
   * Kanonische Form einer Zeile — identisch für Client-Zeilen (_cardsToRows) und
   * Server-Zeilen (load_*_data), damit ein Round-Trip denselben Hash ergibt.
   * updated_at/created_at (Karten) sind Metadaten und bleiben außen vor.
   */
  const canon = {
    cards: (r) => ({
      subject: str(r.subject),
      front: str(r.front),
      back: str(r.back),
      level: int(r.level),
      due_at: ms(r.due_at),
      ease: Math.round(Number(r.ease == null || r.ease === '' ? 2.5 : r.ease) * 1000) / 1000,
      reps: int(r.reps),
      interval_days: int(r.interval_days),
      topic: opt(r.topic),
      exam_name: opt(r.exam_name),
      exam_date: dateOnly(r.exam_date),
      explain: opt(r.explain),
    }),
    tasks: (r) => ({
      title: str(r.title),
      subject: opt(r.subject),
      due_at: dateOnly(r.due_at),
      completed: !!r.completed,
    }),
    exams: (r) => ({
      subject: str(r.subject),
      score: int(r.score),
      total: int(r.total),
      created_at: ms(r.created_at),
    }),
  };

  function rowHash(type, row) {
    return hash(JSON.stringify(canon[type](row)));
  }

  /** Basis-Abbild (id → Hash) aus einem Zeilensatz { cards:[], tasks:[], exams:[] }. */
  function baseFrom(rows) {
    const out = {};
    for (const type of TYPES) {
      out[type] = {};
      for (const r of rows?.[type] || []) {
        if (r && UUID_RE.test(r.id || '')) out[type][r.id] = rowHash(type, r);
      }
    }
    return out;
  }

  function byId(rows) {
    const m = new Map();
    for (const r of rows || []) if (r && r.id) m.set(String(r.id), r);
    return m;
  }

  /** Vorläufige Konfliktwahl (siehe Kopfkommentar, Regel 5). */
  function defaultChoice(type, l, s) {
    if (!l) return 'remote';
    if (!s) return 'local';
    if (type === 'cards' && int(l.reps) > int(s.reps)) return 'local';
    return 'remote';
  }

  /**
   * Führt einen Entitätstyp zusammen.
   * @returns {{ rows: Array<{id:string, source:'local'|'remote', row:object}>,
   *             conflicts: Array<{type:string,id:string,local:object|null,remote:object|null,choice:'local'|'remote'}>,
   *             changed: boolean }}   changed = Ergebnis weicht vom Serverstand ab (→ Sync nötig)
   */
  function mergeType(type, localRows, serverRows, baseHashes) {
    const L = byId(localRows);
    const S = byId(serverRows);
    const B = baseHashes || null;
    const ids = new Set([...L.keys(), ...S.keys(), ...(B ? Object.keys(B) : [])]);
    const rows = [];
    const conflicts = [];
    let changed = false;
    // Lokale Zeilen ohne id: können nirgends zugeordnet werden → lokal neu
    for (const r of localRows || []) {
      if (r && !r.id) {
        rows.push({ id: null, source: 'local', row: r });
        changed = true;
      }
    }
    for (const id of ids) {
      const l = L.get(id) || null;
      const s = S.get(id) || null;
      const hl = l ? rowHash(type, l) : null;
      const hs = s ? rowHash(type, s) : null;
      let pick; // 'local' | 'remote' | 'delete'
      if (!B) {
        // Ohne Basis: Vereinigung, bei gleicher id gewinnt der Server, nichts wird gelöscht
        pick = s ? 'remote' : 'local';
      } else {
        const b = Object.prototype.hasOwnProperty.call(B, id) ? B[id] : undefined;
        const localChanged = l ? b === undefined || hl !== b : b !== undefined;
        const remoteChanged = s ? b === undefined || hs !== b : b !== undefined;
        if (!localChanged && !remoteChanged) pick = s ? 'remote' : 'delete';
        else if (!localChanged) pick = s ? 'remote' : 'delete';
        else if (!remoteChanged) pick = l ? 'local' : 'delete';
        else if (l && s && hl === hs) pick = 'remote';
        else if (!l && !s) pick = 'delete';
        else {
          const choice = defaultChoice(type, l, s);
          conflicts.push({ type, id, local: l, remote: s, choice });
          pick = choice;
        }
      }
      if (pick === 'delete') {
        if (s) changed = true; // Server hat die Zeile noch → Löschung muss hochgeladen werden
        continue;
      }
      const row = pick === 'local' ? l : s;
      rows.push({ id, source: pick, row });
      const hr = pick === 'local' ? hl : hs;
      if (!s || hr !== hs) changed = true;
    }
    return { rows, conflicts, changed };
  }

  /**
   * Führt alle drei Typen zusammen.
   * @param {{cards:[],tasks:[],exams:[]}} local
   * @param {{cards:[],tasks:[],exams:[]}} server
   * @param {{cards:{},tasks:{},exams:{}}|null} base  — null = keine Basis bekannt
   */
  function merge(local, server, base) {
    const out = { conflicts: [], changed: false, hasBase: !!base, _server: server || null };
    for (const type of TYPES) {
      const r = mergeType(
        type,
        local?.[type] || [],
        server?.[type] || [],
        base ? base[type] || {} : null
      );
      out[type] = r.rows;
      out.conflicts.push(...r.conflicts);
      out.changed = out.changed || r.changed;
    }
    return out;
  }

  /**
   * Wendet Nutzerentscheidungen auf ein Merge-Ergebnis an.
   * @param {object} result   — Rückgabe von merge()
   * @param {Record<string,'local'|'remote'>} choices — id → gewählte Seite
   */
  function applyChoices(result, choices) {
    for (const c of result.conflicts) {
      const choice = choices && choices[c.id] ? choices[c.id] : c.choice;
      c.choice = choice;
      const list = result[c.type];
      const idx = list.findIndex((r) => r.id === c.id);
      const row = choice === 'local' ? c.local : c.remote;
      if (!row) {
        if (idx >= 0) list.splice(idx, 1); // gewählt: Löschung
      } else if (idx >= 0) {
        list[idx] = { id: c.id, source: choice, row };
      } else {
        list.push({ id: c.id, source: choice, row });
      }
    }
    // changed neu bestimmen: weicht das Ergebnis vom Serverstand ab?
    result.changed = TYPES.some((type) => {
      const S = byId(result._server?.[type]);
      const res = result[type];
      if (!result._server) return res.some((r) => r.source === 'local');
      if (res.length !== S.size) return true;
      return res.some((r) => {
        const s = S.get(r.id);
        return !s || rowHash(type, r.row) !== rowHash(type, s);
      });
    });
    return result;
  }

  return {
    TYPES,
    UUID_RE,
    hash,
    canon,
    rowHash,
    baseFrom,
    mergeType,
    merge,
    applyChoices,
  };
});
