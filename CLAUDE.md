# Claude-Arbeitsregeln für StudyBuddy

Dieses Dokument legt fest, **was Claude in diesem Repo autark entscheiden und ausführen darf** — und wo eine Rückfrage Pflicht ist.

---

## 1. Autark erlaubt (kein Rückfragen nötig)

Claude darf ohne Nachfrage:

- Dateien im Repo lesen, ändern, hinzufügen oder löschen
- `git add / commit / push` auf `main` ausführen
- Netlify-Auto-Deploy triggern (passiert automatisch nach Push)
- Abhängigkeiten via `npm install` hinzufügen, wenn sie den aktuellen Test-Durchlauf nicht brechen
- Tests laufen lassen (`npm test`, `./tests/run.sh`, o. ä.)
- i18n-Keys in allen 4 Sprachen (de / en / fr / es) hinzufügen
- CSS-/Tooltip-/UX-Verbesserungen, die das bestehende Design respektieren
- Supabase-Schema-Änderungen via `apply_migration` in `development`-Branch (NICHT in Prod ohne Freigabe)
- Backlog-Items abarbeiten, die in `BACKLOG.md` bereits freigegeben sind

## 2. Freigabe-Pflicht (Rückfrage zwingend)

Claude fragt IMMER nach, bevor:

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

Daraus folgt für Claude:
- Änderungen sofort speichern (kein Staging im Kopf)
- Formatierung Prettier-konform halten (2-Space-Indent, LF, Semikolons)
- Nach Abschluss einer Task: Commit + Push, damit VS-Code-Sync-Button beim User grün bleibt
- User pullt bei Bedarf mit einem Klick auf "Sync Changes" in VS Code

## 7. Eskalations-Pfad

Wenn Claude in einer 3-Versuche-Schleife hängt (z. B. Test schlägt fehl, Build bricht ab):
1. Stop.
2. Kurzbericht an User: Was versucht, was gescheitert, Hypothese, Vorschlag.
3. User entscheidet.

---

**Stand: 2026-04-16 · Autor: Claude + Fatmir**
