<!-- Gespiegelt aus CLAUDE.md (Codex statt Claude). Änderungen in CLAUDE.md machen und hier nachziehen: sed 's/Claude/Codex/g' CLAUDE.md -->
# Codex-Arbeitsregeln für StudyBuddy

Dieses Dokument legt fest, **was Codex in diesem Repo autark entscheiden und ausführen darf** — und wo eine Rückfrage Pflicht ist.

> **Backend: Neon (seit 2026-07-16).** Das Backend wurde von Supabase auf **Neon** (Serverless Postgres, `eu-central-1`/Frankfurt, DSGVO) migriert — Neon Auth, Neon Data API und Netlify Functions. Der Ordner `supabase/migrations/` ist ab jetzt **nur noch historisch**.

---

## 1. Autark erlaubt (kein Rückfragen nötig)

Codex darf ohne Nachfrage:

- Dateien im Repo lesen, ändern, hinzufügen oder löschen
- `git add / commit / push` auf `main` ausführen
- Netlify-Auto-Deploy triggern (passiert automatisch nach Push)
- Abhängigkeiten via `npm install` hinzufügen, wenn sie den aktuellen Test-Durchlauf nicht brechen
- Tests laufen lassen (`npm test`, `./tests/run.sh`, o. ä.)
- i18n-Keys in allen 4 Sprachen (de / en / fr / es) hinzufügen
- CSS-/Tooltip-/UX-Verbesserungen, die das bestehende Design respektieren
- Neon-Schema-Änderungen via Neon MCP (`prepare_database_migration` / `run_sql`) auf einem **dev-Branch** (NICHT auf Prod ohne Freigabe)
- Backlog-Items abarbeiten, die in `BACKLOG.md` bereits freigegeben sind

## 2. Freigabe-Pflicht (Rückfrage zwingend)

Codex fragt IMMER nach, bevor:

- Destruktive DB-Migrationen auf Produktion laufen (DROP, TRUNCATE)
- Externe API-Keys / Secrets ausgetauscht werden
- Zahlungsflüsse, E-Mail-Versand an echte User oder Push-Notifications ausgelöst werden
- Eine Änderung mehr als 500 Zeilen Produktionscode gleichzeitig betrifft
- Design-Sprache / Farbschema / Logo geändert werden

## 3. Commit-Stil

- Deutsch, Konventionell: `feat: …`, `fix: …`, `refactor: …`, `docs: …`, `test: …`
- Max. 72 Zeichen Betreff, optionaler Body
- Ein Commit = ein logischer Schritt (keine Sammel-Commits mit unabhängigen Themen)

## 4. Test-Pflicht

Vor jedem Push gegen `main`:

1. `node --check app.html index.html` (JS-Syntax-Sanity, wenn inline-JS)
2. Manueller Smoke-Test im Browser-Tab (mittels Netlify-Preview oder Live-Server)
3. Falls vorhanden: `tests/last_report.json` auf 100 % prüfen

## 5. Git-Lock-Workaround

Falls `.git/index.lock` nicht gelöscht werden kann (Sandbox-Beschränkung):

```bash
# In /tmp frisch klonen, dort committen, dann pushen
git clone https://github.com/<user>/studybuddy /tmp/sb-fresh
cp -r <geänderte Dateien> /tmp/sb-fresh/
cd /tmp/sb-fresh && git add -A && git commit -m "…" && git push
```

Siehe `scripts/autopush.sh` für den automatisierten Helper.

## 6. Workflow im Einklang mit VS Code

Der User arbeitet in VS Code mit:
- `git.postCommitCommand: "push"` → Commits pushen automatisch
- Auto-Save nach 1 s
- Prettier als Formatter
- Live-Server-Extension

Daraus folgt für Codex:
- Änderungen sofort speichern (kein Staging im Kopf)
- Formatierung Prettier-konform halten (2-Space-Indent, LF, Semikolons)
- Nach Abschluss einer Task: Commit + Push, damit VS-Code-Sync-Button beim User grün bleibt
- User pullt bei Bedarf mit einem Klick auf "Sync Changes" in VS Code

## 7. Eskalations-Pfad

Wenn Codex in einer 3-Versuche-Schleife hängt (z. B. Test schlägt fehl, Build bricht ab):
1. Stop.
2. Kurzbericht an User: Was versucht, was gescheitert, Hypothese, Vorschlag.
3. User entscheidet.

## 8. Aktueller Stand (2026-09-02) — Härtungsplan

- **Stufe 0 abgeschlossen, Stufe 1/2 teilweise.** Maßnahmen, Commit-Hashes, Nachweise und offene Punkte stehen in `BACKLOG.md` → „Härtung 2026-09". Nicht daraus abweichen, ohne den Eintrag dort zu aktualisieren.
- **Erkenntnis, die nicht vergessen werden darf:** Die Eltern-Cloud-Persistenz (`sync_my_data`/`load_my_data`) war von der Neon-Migration (2026-07-16) bis `183ad4f` (2026-09-02) **komplett defekt** (42501, von leeren `catch`-Blöcken verschluckt). `BACKLOG.md` P0.1 galt in dieser Zeit fälschlich als erledigt. Lehre: „erledigt" heißt **nachgewiesener Round-Trip gegen Produktion**, und Fehler müssen sichtbar sein.
- **DB-Änderungen** — auch wenn per Neon-MCP ausgeführt — immer als Datei `neon/migrations/NNN_….sql` mit Befund, Begründung und Verifikation ablegen. `supabase/migrations/` ist nur Historie.
- **Nur der Betreiber kann:** `CHILD_TOKEN_SECRET` in Netlify setzen (bis dahin liefert der Kind-KI-Pfad bewusst 503 — kein Bug), Neon-Auth-Flags in der Konsole, die zwei Familienkonten neu registrieren. Liste: `BACKLOG.md` → „Offene Nutzer-Aufgaben".
- **Bewusst noch nicht angefasst:** Sync-Semantik/Konflikte (1.1), PIN-Klartext (1.5), Accessibility (2.5), Lazy-Loading (2.6), Recht (2.7).

---

**Stand: 2026-09-02 · Autor: Codex + Fatmir**
