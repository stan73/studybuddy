# StudyBuddy Pro — Feature-Backlog & Roadmap

Stand: 2026-06-25 | Priorisiert nach **Wirkung auf Kernschleife (Lernerfolg + Bindung) × Aufwand**
Aufwand: **S** = < 1 Tag · **M** = 1–3 Tage · **L** = > 3 Tage

> Grundlage: Architektur-Bewertung gegen Best-in-Class (Anki/FSRS, Quizlet, Duolingo, Khanmigo, Photomath, Knowunity/StudySmarter, simpleclub, Anton, Untis). Stärken heute: RLS-Sicherheit, gekapselte KI-Keys (`ai-proxy` Netlify Function), sauberes Token-Design-System, **Eltern-Kontrolle als echter Vorsprung**. Hauptlücken: Persistenz, Retention-Mechanik, Content-Ingestion, Accessibility.

---

## 🔴 P0 — Fundament & Compliance (zuerst — sonst trägt der Rest nicht)

### [x] P0.1 · Persistenz vollständig migrieren — **ERLEDIGT (2026-06-25, Commit `0f04379`, live) · jetzt auf Neon (2026-07-16)**
Karten/Aufgaben/Prüfungen werden geräteübergreifend in der DB gespeichert (Migration 008: `child_id` + PIN-/RLS-RPCs `sync_my_data`/`load_my_data`/`sync_child_data`/`load_child_data`). localStorage nur noch Offline-Cache + einmalige Migration. Verifiziert: DB-Round-Trip + Browser-Smoke-Test (Schreiben + Cross-Device-Laden). **Backend seit 2026-07-16 auf Neon** (Neon Data API statt Supabase-Client); Schema/RPCs/RLS 1:1 re-portiert, Zugriff via `js/vendor/neon-client.js` (Supabase-kompatible Fassade), RLS weiterhin über `auth.uid()`.
- **Akzeptanz:**
  - Karteikarten, `tasks`, `exams`, `sessions`, `user_stats` werden ausschließlich in der Neon-DB gelesen/geschrieben (kein `localStorage` als Quelle der Wahrheit).
  - Login auf zweitem Gerät zeigt identischen Stand (Karten, Streak, XP, Aufgaben).
  - **Streak-Bug behoben:** `update_child_stats` speichert zuverlässig (PIN-in-Session-Workaround dokumentiert/gelöst).
  - Offline erstellte Daten syncen beim nächsten Online-Gang (PWA).

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

- [ ] **Schulauswahl aus validierter Liste (kein Freitext)** — Neon-Tabelle `schools` (`id`, `name`, `city`, `state`, `school_type`, `official_id`), befüllt aus amtlichem Schulverzeichnis (Statistisches Bundesamt / KMK, alt. Wikidata). Autocomplete `/api/schools?q=`. Jährl. Sync via Netlify Function / GitHub Action (cron). *(Migration `006_schools.sql` + `007_children_school.sql` vorhanden — historisch, jetzt 1:1 auf Neon re-portiert; Import-Script `scripts/import_schools.py`.)*
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

- [ ] Nach Passwort-Reset landet App auf `app.html#reset-password` — Formular noch nicht implementiert.
- [x] Kind-Streak-Bug behoben (P0.1): PIN bleibt im Speicher → `sync_child_data` schreibt Kind-Stats zuverlässig. *(2026-06-25)*
- [ ] `js/api/claude.js.DELETE` — toten Datei-Rest entfernen.
- [ ] Rate-Limiting in der `ai-proxy` Netlify Function pro User statt pro Browser-Tab → mit P0.3 zusammenlegen.
- [ ] Automatische Session-Verlängerung (Neon Auth Session-Refresh, konfigurierbar via `configure_neon_auth` / Neon-Konsole).
- [ ] E-Mail-Bestätigung nach Registrierung aktivieren (Neon Auth Config via `configure_neon_auth` / Neon-Konsole).
- [ ] **Quick-Wins aus `StudyBuddy_old` prüfen/portieren** — #9/#14/#16/#1 + XLSX-Export wurden versehentlich im archivierten Single-File-Repo umgesetzt.
