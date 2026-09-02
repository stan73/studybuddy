# StudyBuddy Pro — Feature-Backlog & Roadmap

Stand: 2026-09-02 | Priorisiert nach **Wirkung auf Kernschleife (Lernerfolg + Bindung) × Aufwand**
Aufwand: **S** = < 1 Tag · **M** = 1–3 Tage · **L** = > 3 Tage

> Grundlage: Architektur-Bewertung gegen Best-in-Class (Anki/FSRS, Quizlet, Duolingo, Khanmigo, Photomath, Knowunity/StudySmarter, simpleclub, Anton, Untis). Stärken heute: RLS-Sicherheit, gekapselte KI-Keys (`ai-proxy` Netlify Function), sauberes Token-Design-System, **Eltern-Kontrolle als echter Vorsprung**. Hauptlücken: Persistenz, Retention-Mechanik, Content-Ingestion, Accessibility.

---

## 🛡️ Härtung 2026-09 — Stand (Stufe 0 komplett, Stufe 1/2 teilweise)

**Kernbefund:** Die Eltern-Cloud-Persistenz war von der Neon-Migration (2026-07-16) bis zum 2026-09-02 **komplett defekt** — `sync_my_data`/`load_my_data` liefen als `SECURITY INVOKER` (Rolle `authenticated` hat kein `USAGE` auf Schema `auth`) und scheiterten bei jedem Aufruf mit 42501; die Fehler wurden von leeren `catch`-Blöcken verschluckt. Sieben Wochen lang hat kein Elternteil Karten/Aufgaben/Prüfungen geschrieben oder geladen (`cards` = 0 Zeilen). P0.1 galt in dieser Zeit fälschlich als erledigt. Der Kind-Pfad (`*_child_data`, PIN) war nicht betroffen.

| Maßnahme | Commit | Nachweis |
|---|---|---|
| 0.1 Konto-Übernahme über `link-profile` geschlossen (E-Mail nur aus `neon_auth."user"`, Umhängen nur bei verifizierter E-Mail) | `f745d9d` | Tests 156/156; `neon/migrations/003` |
| 0.2 KI-Key nicht mehr clientseitig aus `api_keys` lesbar (kein SELECT-Policy) | `bac3bcc` | `neon/migrations/001` |
| 0.3 `ai-proxy` gehärtet: Kind-Token (HMAC), Limits, Timeout, CORS; `consume_ai_quota` nur Owner | `c47e34b` | Token-Roundtrip lokal; `neon/migrations/002` |
| neon-js 0.7.0-beta gepinnt und lokal gebündelt (kein esm.sh, CSP enger) | `f1f63b1` | SBOM |
| 1.7 Fehler sichtbar: 19 leere `catch`-Blöcke, globale Handler, `renderFatalError` | `7e92850` | Tests 156/156 |
| 1.2 Session-Gate: `U` nur aus serverseitig geprüfter Session, Ablauf erkannt | `1f3728f` | — |
| 1.3 Passwort-Reset in `app.html#reset-password` abgeschlossen | `cf63d52` | — |
| **1.0 Eltern-Persistenz repariert:** `sync_my_data`/`load_my_data` als `SECURITY DEFINER` mit `search_path`, EXECUTE nur `authenticated` | `183ad4f` | **echter Round-Trip über die Data API** (204/200, 25/25 Felder); `neon/migrations/004` |
| Service Worker v6: ein Fetch-Listener, Vendor-Precache, `/app/*`-Shell | `105ca26` | — |
| `search_path = public, pg_temp` bei **allen** 8 `SECURITY DEFINER`-Funktionen | `64178fb` | `pg_proc.proconfig`: 0 ungehärtet; `neon/migrations/005` |
| `.prettierrc` = Projektstil; `sw.js` zurückformatiert; Formatierungsschuld in `.prettierignore` | `2a88f13` | `prettier --check` |
| 2.4 Toter Parallelcode gelöscht (`js/`-Module, `js/vendor/supabase.js`, `supabase/functions/`), Supabase-Reste in Kommentaren/Doku berichtigt | `2c12a66` | grep `<script src=`/`import`: nur `js/vendor/*` geladen; Tests 156/156 |

**Offen (bewusst noch nicht angefasst):** 1.1 Sync-Semantik/Konflikterkennung (Whole-Replace, Last-Writer-Wins) · 1.5 Kind-PIN im Klartext in `sessionStorage` · 2.2 CI als Deploy-Tor · 2.5 Accessibility · 2.6 Lazy-Loading der Vendor-Bibliotheken · 2.7 Rechtliches (Impressum/Datenschutz/AVV).

**Regel ab jetzt:** „erledigt" nur mit nachgewiesenem Round-Trip gegen Produktion. Jede DB-Änderung — auch wenn per Neon-MCP ausgeführt — wird als `neon/migrations/NNN_….sql` mit Befund, Begründung und Verifikation abgelegt.

---

## 🙋 Offene Nutzer-Aufgaben (nur der Betreiber kann das)

- [ ] **`CHILD_TOKEN_SECRET` in Netlify setzen** (Site → Environment variables; ≥ 32 zufällige Bytes, z. B. `openssl rand -hex 32`). Bis dahin antwortet der Kind-Pfad der KI-Funktionen **bewusst mit 503** (kein Rückfall auf ungeprüfte Anfragen). Nach dem Setzen: Redeploy auslösen.
- [ ] **Neon-Auth-Flags in der Neon-Konsole** (mit den MCP-Tools nicht setzbar): `require_email_verification` / `verify_email_on_sign_up` einschalten und `allow_localhost = false`. **Vorbedingung:** eine OTP-Eingabe im Client (`email_verification_method: otp`) — sonst sperrt man Neuregistrierungen aus. Bis dahin verifiziert der Betreiber migrierte Konten manuell (Vorlage in `neon/migrations/003`).
- [ ] **Zwei Familienkonten neu registrieren** (die in `neon/migrations/003` genannten Adressen): Supabase-Passwort-Hashes waren nicht migrierbar; `link-profile` hängt die alten Profile samt Kindern nach der Neuregistrierung automatisch um — dafür muss die E-Mail als verifiziert markiert sein (siehe Vorlage). Bis dahin existieren diese Familien in Neon Auth nicht.

---

## 🔴 P0 — Fundament & Compliance (zuerst — sonst trägt der Rest nicht)

### [x] P0.1 · Persistenz vollständig migrieren — **ERLEDIGT auf Supabase (2026-06-25, `0f04379`) · nach der Neon-Migration für Eltern DEFEKT (2026-07-16 → 2026-09-02) · repariert `183ad4f`**
Karten/Aufgaben/Prüfungen werden geräteübergreifend in der DB gespeichert (historische Migration 008: `child_id` + PIN-/RLS-RPCs `sync_my_data`/`load_my_data`/`sync_child_data`/`load_child_data`). localStorage nur Offline-Cache + einmalige Migration.
**Korrektur der Historie:** Der Eintrag „jetzt auf Neon (2026-07-16)" war **unwahr**. Die Schema-Portierung ließ `sync_my_data`/`load_my_data` als `SECURITY INVOKER` zurück; auf Neon hat die Rolle `authenticated` kein `USAGE` auf Schema `auth`, also scheiterte `auth.uid()` mit 42501 — bei jedem Laden und jedem Speichern, still. Der E2E-Test vom 2026-07-18 hatte das bereits gezeigt, es wurde aber nicht behoben. Erst `183ad4f` (`neon/migrations/004`) stellt beide RPCs auf `SECURITY DEFINER` mit `search_path` um; Nachweis per echtem Round-Trip über die Data API (siehe „Härtung 2026-09"). Zugriff weiterhin via `js/vendor/neon-client.js` (Supabase-kompatible Fassade), RLS über `auth.uid()` (`pg_session_jwt`).
- **Akzeptanz (Stand 2026-09-02):**
  - ✅ Karteikarten, `tasks`, `exams` werden für Eltern wieder in Neon gelesen/geschrieben (Round-Trip nachgewiesen); `sessions`, `user_stats` unverändert.
  - ✅ Kind-Pfad (`sync_child_data`/`load_child_data`/`update_child_stats`) war nie betroffen.
  - ⚠️ Login auf zweitem Gerät zeigt identischen Stand — gilt wieder, aber die Sync-Semantik ist Whole-Replace ohne Konflikterkennung (Härtung 1.1, offen).
  - ⏳ Offline erstellte Daten syncen beim nächsten Online-Gang — ungetestet seit der Reparatur.

### [~] P0.2 · Accessibility auf WCAG 2.1 AA — **TEILWEISE (2026-06-25, Commit `d419114`, live)**
Erledigt: `prefers-reduced-motion`, aria-labels auf icon-only Buttons (focus-visible/nav-aria/content-aria-live/toast-role waren bereits da). Offen (iterativ): Kontrast-Audit, Lighthouse ≥ 95, vollständige Tastatur-/Screenreader-Tests.
Heute: 13× `aria-`, 1× `tabindex`, 0 `alt`, 0 `prefers-reduced-motion`. **Rechtspflicht:** European Accessibility Act (seit 06/2025) + BITV 2.0 — ohne AA-Konformität ist Schul-/Behörden-Vertrieb blockiert.
- **Akzeptanz:**
  - Alle interaktiven Elemente per Tastatur erreichbar + sichtbarer Fokus-Ring; logische Tab-Reihenfolge.
  - aria-Labels für Icon-Buttons, `role`/`aria-live` für Toasts/Modals, `alt` für Bilder/Icons.
  - `@media (prefers-reduced-motion)` deaktiviert nicht-essenzielle Animationen.
  - Kontrast ≥ 4.5:1 (Token-Check); Lighthouse-A11y-Score ≥ 95.

### [~] P0.3 · Stripe + serverseitiges Free-Tier-Limit — **Free-Limit ERLEDIGT (Commit `9707ed7`, live); Stripe OFFEN (braucht Credentials)**
Free-Tier-Limit: ✅ 20 KI-Anfragen/Tag pro Account serverseitig im ai-proxy (Migration 010 `ai_usage` + `consume_ai_quota`, HTTP 429). Stripe-Checkout/Webhook: ⏳ benötigt Stripe-Konto + Secret-Key + Webhook-Secret + Price-IDs des Users.
Abo ist heute reines UI-Mockup. Free-Limit muss in der `ai-proxy` Netlify Function greifen, nicht pro Browser-Tab.
- **Akzeptanz:**
  - Echter Stripe-Checkout für `family_plus` / `family_pro` / `teacher`; Webhook (Netlify Function) setzt `profiles.subscription`.
  - Free-Tier: max. N KI-Anfragen/Tag **pro User** serverseitig (`ai-proxy` Netlify Function), nicht pro Browser.
  - Abo-Status steuert Feature-Gates in der UI.

---

## 🟠 P1 — Differenzierung & Bindung (der Wachstumshebel)

### [~] P1.1 · Retention-Engine (Duolingo-Motor) — **Kern ERLEDIGT; nur echtes Push/Mail offen**
Erledigt: ✅ Tages-Lernziel (Dashboard-Banner + Fortschrittsbalken) · ✅ **Streak-Fix** (`touchStreak`) · ✅ Streak-Freeze (wöchentlich 1, max 3) · ✅ Tagesziel/Freeze **cross-device gesynct** (Migr. 011, Commit `7274217`) · ✅ Eltern-**Inaktivitäts-Banner** (≥3 Tage) · ✅ **lokale** Fällig-Erinnerung (Browser-Notification, Opt-in; Commit `550d899`). Offen (brauchen Infra): ⏳ echte **PWA-Push** (VAPID + Push-Server) · ⏳ Eltern-**Wochenmail** (Scheduled Job — GitHub-Action-Cron oder Netlify Scheduled Function — + E-Mail-Dienst).
- **Akzeptanz:**
  - ✅ Tages-Lernziel (Eltern setzbar: z.B. „30 min/Tag", „5 Karten/Tag") mit Fortschrittsanzeige.
  - ✅ Streak-Freeze (1×/Woche automatisch oder kaufbar).
  - ⏳ PWA-Push „Diese 3 Karten sind heute fällig" + Eltern-Benachrichtigung bei Inaktivität ≥ X Tage.
  - ⏳ Eltern-Wochenbericht per E-Mail (Scheduled Job — GitHub-Action-Cron oder Netlify Scheduled Function — + E-Mail-Dienst).

### [x] P1.2 · Foto/PDF → Karteikarten via KI — **ERLEDIGT (2026-06-25, Commit `3a0839e`, ai-proxy v4, live)** *(PDF nur mit Claude)*
Größter wahrgenommener Mehrwert; hier gewinnen Knowunity/StudySmarter.
- **Akzeptanz:**
  - Upload Bild/PDF → KI extrahiert Inhalte → Vorschlag editierbarer Karten → Speichern in `cards`.
  - Funktioniert für Foto eines Arbeitsblatts/einer Buchseite (OCR via Vision-Modell).
  - Free-Tier-Limit greift (siehe P0.3).

### [x] P1.3 · SR-Algorithmus FSRS/SM-2 statt fixer Leiter — **ERLEDIGT (2026-06-25, Commit `f5ce636`, Migration 009, live)**
Heute fixe Leiter `SR_DAYS=[1,3,7,14,30]`. Adaptive Intervalle pro Karte → spürbar besserer Lernerfolg bei gleichem Aufwand.
- **Akzeptanz:**
  - `cards` um `ease`, `reps`, `lapses` (oder FSRS-Stability/Difficulty) erweitert (Migration).
  - Antwortqualität (z.B. „nochmal / schwer / gut / einfach") steuert nächstes Intervall pro Karte individuell.
  - Bestehende Karten migrieren verlustfrei (Default-Ease).

---

## 🟡 P2 — Markt-spezifisch (DE) & KI-Tiefe

### [ ] P2.1 · Untis-Stundenplan-Integration — **M**
Für den DE-Schulmarkt höherer Hebel als Teams; speist den Lernplaner automatisch.
- **Akzeptanz:** Kind/Eltern verbinden Untis → Stundenplan + Hausaufgaben erscheinen im Planer; tägl. Sync.

### [ ] P2.2 · KI-Tutor mit Gedächtnis + Curriculum-Grounding — **M**
- **Akzeptanz:**
  - Gesprächsverlauf pro Kind/Fach in Neon persistiert, über Sessions hinweg verfügbar.
  - System-Prompt sokratisch + auf Klassenstufe/Lehrplan geerdet (gibt Hilfe, nicht nur Lösung).
  - KI-Zusammenfassungen pro Fach (auf Basis der Karteikarten).
  - Schwierigkeitsgrad im Prüfungsmodus wählbar (leicht / mittel / schwer).

### [x] P2.3 · Onboarding-Flow + Skeleton-Screens — **ERLEDIGT (2026-06-25, Commit `df82172`)**
Erledigt: einmaliges rollenbasiertes Willkommens-Modal (`maybeOnboarding`) + Skeleton-Screens (`.skeleton`-Shimmer) statt Spinner beim Laden. Verfeinerung möglich: mehrstufiger geführter Flow, leere Zustände mit CTA.
- **Akzeptanz:** Geführter Erststart (Rolle, erstes Kind/Fach, erste Karten); leere Zustände mit klarer CTA; Skeleton-Screens beim Laden.

---

## 🟢 P3 — Später / strategisch

### [ ] P3.1 · Sozial / Klassen-Pool — **L**
Geteilte Karten-Sets & Aufgaben pro Klasse; hoher Bindungseffekt, hoher Aufwand. (Detail unten „Schul-Anbindung".)
- **Akzeptanz:** Schüler gleicher `school_id` + `grade` → virtuelle Klasse (Eltern-Opt-in, DSGVO); `shared_cards`/`shared_tasks`-Pool; Echtnamen nur für vernetzte Klassenkameraden.

### [x] P3.2 · Dark-Mode-Toggle — **ERLEDIGT (2026-06-27, Commit `5a747e8`, live)**
Hell/Dunkel/System via `[data-theme]` + Früh-Apply (kein Flash). Theme-Card in Settings (Eltern & Kinder), `localStorage['sb_theme']`.

### [ ] P3.3 · Native App-Hülle (iOS/Android) — **L**
Erst wenn PWA-Push-Grenzen (v.a. iOS) real limitieren.

---

## 🏫 Schul-Anbindung — Detailnotizen (gehört zu P2.1 / P3.1)

- [ ] **Schulauswahl aus validierter Liste (kein Freitext)** — Neon-Tabelle `schools` (`id`, `name`, `city`, `state`, `school_type`, `official_id`), befüllt aus amtlichem Schulverzeichnis (Statistisches Bundesamt / KMK, alt. Wikidata). Autocomplete `/api/schools?q=`. Jährl. Sync via Netlify Function / GitHub Action (cron). *(Historische Migrationen `006_schools.sql` + `007_children_school.sql`, 1:1 auf Neon re-portiert. **Stand 2026-09-02:** Neon-Tabelle `schools` hält 32 343 Einträge (jedeschule-Import vom 2026-04-08); die App sucht darin per RPC `search_schools`. Der wöchentliche GitHub-Action-Import und `scripts/import_schools.py` wurden entfernt — sie liefen gegen das stillgelegte Supabase-Projekt, kein Kind hat bisher eine Schule verknüpft, und ein Neon-Rewrite bräuchte ein DB-Secret in GitHub ohne aktuellen Nutzen. Bei Bedarf neu bauen: Netlify Scheduled Function oder Action gegen Neon, Datenquelle jedeschule.de.)*
- [ ] **Microsoft Teams Integration pro Kind** — Kein Schul-Admin-Zugriff; nur Schüler-Login. Delegierte Rechte ohne Admin-Consent: `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `User.Read`. `ChannelMessage.Read.All` braucht Admin-Consent → Fallback: nur Channel-Metadaten. **Beste Alternative:** Microsoft Education API `EduAssignment.ReadBasic` (Schüler-Consent, falls Schule M365 Education A1/A3/A5 nutzt). **Letzter Fallback:** Kind kopiert Inhalte manuell → KI strukturiert (= P1.2). *Nächster Schritt: Schul-Lizenz prüfen.*
- [ ] Weitere Quellen: Google Classroom, Moodle, IServ.

---

## ✅ Erledigt

- [x] **Kind-Settings → Eltern-Kontrolle** (Refactoring): Schulauswahl/Klasse, Fächer, Schulsprache, Kind-E-Mail, Abo, Gefahrenzone aus Kind-Ansicht entfernt → alles im Eltern-Dashboard. Kind liest nur, schreibt nie eigene Profilfelder. *(April 2026)*
- [x] **Fächer ausschließlich durch Eltern verwaltbar** — Checkbox „Kind darf Fächer selbst verwalten" entfernt. *(April 2026)*
- [x] **Mehrsprachigkeit (i18n)** — de/en/fr/es implementiert (`t()`-Mechanik in `app.html`).
- [x] **XLSX-Export lokal gebündelt** (SheetJS) — *(Hinweis: Quick-Wins #9/#14/#16/#1 + dieser Fix liegen im archivierten Single-File-Repo `StudyBuddy_old` / `studybuddy-app` — ggf. portieren, siehe offener Punkt unten.)*

---

## 🐛 Bekannte Bugs / Tech-Debt

- [x] Passwort-Reset: Formular hinter `app.html#reset-password` umgesetzt (Better-Auth `resetPassword`, Commit `cf63d52`). *(2026-09-02)*
- [x] Kind-Streak-Bug behoben (P0.1): PIN bleibt im Speicher → `sync_child_data` schreibt Kind-Stats zuverlässig. *(2026-06-25)*
- [x] Tote `js/`-Module (`config/auth/state/router/api/utils`), `js/vendor/supabase.js` und `supabase/functions/` entfernt — waren nie eingebunden, mit abweichender Logik (Commit `2c12a66`). *(2026-09-02)*
- [ ] **Formatierungsschuld** (`.prettierignore`): `tests/run_tests.js`, `netlify/functions/`, `css/` entsprechen dem `.prettierrc`-Stil noch nicht — je Datei ein reiner Format-Commit, danach aus `.prettierignore` streichen.
- [ ] Rate-Limiting in der `ai-proxy` Netlify Function pro User statt pro Browser-Tab → mit P0.3 zusammenlegen.
- [ ] Automatische Session-Verlängerung (Neon Auth Session-Refresh, konfigurierbar via `configure_neon_auth` / Neon-Konsole).
- [ ] E-Mail-Bestätigung nach Registrierung aktivieren — Neon-Konsole, siehe „Offene Nutzer-Aufgaben"; Vorbedingung ist eine OTP-Eingabe im Client.
- [ ] **Quick-Wins aus `StudyBuddy_old` prüfen/portieren** — #9/#14/#16/#1 + XLSX-Export wurden versehentlich im archivierten Single-File-Repo umgesetzt.
