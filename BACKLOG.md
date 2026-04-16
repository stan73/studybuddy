# StudyBuddy Pro — Feature-Backlog & Änderungswünsche

Stand: April 2026 | Priorität: oben = wichtiger

---

## 👶 Kind-Einstellungen → Eltern-Kontrolle (Refactoring)

- [x] **Kind-Settings leeren, Eltern übernehmen alle Kindpflege** — Die Einstellungsseite des Kindes wurde grundlegend umgebaut. *(umgesetzt April 2026)* Folgende Änderungen:

  **Was aus dem Kind-Bereich rausfliegt:**
  - Schulauswahl + Klasse → wird von Eltern pro Kind gepflegt (Eltern-Dashboard)
  - Fächerauswahl → Eltern legen Fächer pro Kind fest (bereits Eltern-getriggert, aber Kind kann noch selbst ändern — das entfernen)
  - Schulsprache → Eltern setzen pro Kind
  - E-Mail des Kindes → Eltern pflegen (Kinder haben keine eigene E-Mail-Verwaltung)
  - Subscription-Sektion → komplett entfernen aus Kind-Ansicht (Subscription ist Elternsache)
  - Gefahrenzone / Daten-Reset → entfernen (Kinder dürfen keine Daten löschen — bereits im Backlog)

  **Was in Kind-Settings bleibt (jetzt leer, Platzhalter für Zukunft):**
  - Die Settings-Sektion bleibt erhalten (Sidebar-Eintrag + leere Seite)
  - Vorbereitet für zukünftige Kind-eigene Präferenzen: Erscheinungsbild (Hell / Dunkel / System), ggfs. Avatar/Nickname
  - Vorerst nur kurzer Hinweistext: „Deine Einstellungen werden von deinen Eltern verwaltet."

  **Was im Eltern-Dashboard hinzukommt (pro Kind):**
  - Schulauswahl (Autocomplete aus `schools`-Tabelle) + Klasse/Kurs
  - Fächerverwaltung (welche Fächer sind für dieses Kind aktiv)
  - Schulsprache (Sprache der Benutzeroberfläche für das Kind)
  - E-Mail des Kindes (optional, für Benachrichtigungen)
  - Alle zukünftigen Kind-Attribute landen hier

  **Datenmodell:** Alle Kind-Attribute bleiben in der `children`-Tabelle (kein Selbst-Edit durch Kind). Das Kind liest nur, schreibt nie eigene Profilfelder.

---

## 🔒 Sicherheit & Berechtigungen

- [ ] **Gefahrenzone aus Kind-Einstellungen entfernen** — Kinder dürfen ihre eigenen Daten nicht löschen können. Stattdessen: Eltern können im Eltern-Dashboard pro Kind die Daten einzeln zurücksetzen (inkl. Bestätigung).
- [ ] **Kind-Account nur über bestehendes Eltern-Login einrichtbar** — Ein Kind kann sich nicht selbst registrieren. Der Registrierungsflow für Kinder wird vollständig aus der Landing-Page entfernt. Kinder werden ausschließlich vom Elternteil im Eltern-Dashboard angelegt.

---

## 🏫 Schul-Anbindung (pro Kind)

- [ ] **Schulauswahl aus validierter Liste (kein Freitext)** — Schüler und Eltern wählen die Schule nicht mehr per Freitext, sondern aus einer offiziell gepflegten Schulliste. Die Liste wird regelmäßig online abgeglichen.
  - **Datenbasis:** Supabase-Tabelle `schools` (`id`, `name`, `city`, `state`, `school_type`, `official_id`) — befüllt aus offiziellem Schulverzeichnis (z.B. Statistisches Bundesamt / Kultusministerkonferenz-Daten, alternativ Wikidata-Dump)
  - **Sync-Strategie:** Einmaliger CSV-Import zum Launch; jährliches Update via Supabase Edge Function oder GitHub Action (cron)
  - **UI:** Autocomplete-Suchfeld (`/api/schools?q=`) statt Freitext-Input; Anzeige: Name + Stadt + Schulart
  - **Klassen-Matching:** Schüler mit gleicher `school_id` + gleichem `grade` bilden eine virtuelle Klasse. Opt-in über Eltern-Dashboard (DSGVO: explizite Einwilligung erforderlich)
  - **Vernetzung & Teilen:** Schüler derselben Klasse können (mit gegenseitiger Freigabe) Karteikarten-Sets und Lernaufgaben teilen — als „Klassenraum"-Pool in Supabase (`shared_cards`, `shared_tasks`)
  - **Datenschutz:** Kinder sind per Default nicht sichtbar; Eltern müssen Vernetzung explizit freischalten. Echtnamen nur für vernetzte Klassenkameraden sichtbar, ansonsten Anzeigename/Avatar.
  - **Nächster Schritt:** Schullisten-Quelle klären (KMK-API, amtliche Schuldaten je Bundesland, oder Wikidata Q-IDs) → CSV-Import-Script schreiben → `schools`-Tabelle in Supabase anlegen

- [ ] **Microsoft Teams Integration pro Kind** — Jedes Kind hat einen Schüler-Microsoft-Login der Schule, über den es Zugriff auf Teams hat. Dort gibt es pro Fach einen eigenen Channel. StudyBuddy soll diese Channels einlesen und Inhalte (Aufgaben, Ankündigungen, Dateien) im Lernplan des Kindes anzeigen.
  - **Ausgangslage:** Wir haben KEINEN Admin-Zugriff auf den Microsoft 365-Tenant der Schule — nur der Kind-Account (Schüler-Login) steht zur Verfügung.
  - **Technische Einschränkung:** Die meisten Graph-API-Berechtigungen für Teams-Nachrichten (`ChannelMessage.Read.All`) erfordern Admin-Zustimmung des Schul-Tenants — die wir nicht einholen können.
  - **Machbarer Weg ohne Schul-Admin:**
    - App in eigenem Azure-Tenant registrieren (multi-tenant, kostenlos)
    - Kind loggt sich einmalig mit Schul-Microsoft-Account ein (OAuth delegated)
    - Delegierte Berechtigungen ohne Admin-Consent möglich: `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `User.Read`
    - Nachrichten lesen (`ChannelMessage.Read.All`) → **erfordert Admin-Consent** → Fallback: nur Channel-Namen + Metadaten anzeigen
  - **Beste Alternative:** Microsoft Education API — `EduAssignment.ReadBasic` erlaubt Schüler-Zustimmung ohne Schul-Admin und gibt Aufgaben/Abgaben zurück. Konkret prüfen ob die Schule Microsoft 365 Education (A1/A3/A5) nutzt.
  - **Fallback-Lösung (ohne jede Admin-Genehmigung):** Kind kopiert Teams-Inhalte manuell in StudyBuddy, KI strukturiert sie automatisch in Karteikarten/Aufgaben.
  - **Nächster Schritt:** Prüfen welche Lizenz die Schule hat (M365 Education?) und ob `EduAssignment`-API verfügbar ist — dafür reicht ein Test-Login des Kindes.
- [ ] Weitere Schulquellen denkbar: Google Classroom, Moodle, IServ, Untis (Stundenplan)

---

## 👨‍👩‍👧 Eltern & Kinder

- [ ] Eltern-Dashboard: Benachrichtigung wenn Kind seit X Tagen nicht gelernt hat
- [ ] Eltern können Lernziele pro Kind setzen (z.B. "30 min/Tag", "5 Karten/Tag")
- [x] **Fächer ausschließlich durch Eltern verwaltbar** — Kinder können Fächer nicht selbst hinzufügen oder entfernen. Die Fächerverwaltung (Tags + Hinzufügen) ist nur im Eltern-Dashboard zugänglich. Die Checkbox „Kind darf Fächer selbst verwalten" wurde entfernt. *(umgesetzt April 2026)*
- [ ] Eltern erhalten Wochenbericht per E-Mail (Supabase Cron + Edge Function)

---

## 🤖 KI & Lernen

- [ ] KI-generierte Zusammenfassungen pro Fach (auf Basis der Karteikarten)
- [ ] Schwierigkeitsgrad im Prüfungsmodus wählbar (leicht / mittel / schwer)
- [ ] KI-Tutor merkt sich den Gesprächsverlauf über Sessions hinweg (Supabase DB)
- [ ] Karteikarten per Bild oder PDF hochladen und automatisch generieren lassen
- [ ] Lernempfehlungen: "Diese 3 Karten sind heute fällig" als Push-Benachrichtigung (PWA)

---

## 🌍 Mehrsprachigkeit (i18n)

- [ ] **App in Deutsch + Englisch** — Die gesamte App-Oberfläche soll in Deutsch und Englisch verfügbar sein. Nutzer wählen die Sprache in den Einstellungen; Kinder erben ggf. die Eltern-Einstellung.
  - **Technischer Ansatz:** JSON-basierte i18n-Strings (`/locales/de.json`, `/locales/en.json`), Sprachumschaltung via `localStorage['lang']`
  - **Scope:** Alle UI-Labels, Fehlermeldungen, KI-SystemPrompts (Tutor antwortet in gewählter Sprache), E-Mail-Templates
  - **Standardsprache:** Deutsch (DE), Fallback: Englisch

---

## 📱 UI & UX

- [ ] Dark Mode Toggle (CSS-Variable schon vorbereitet)
- [ ] Onboarding-Flow für neue Nutzer (Schritt-für-Schritt beim ersten Login)
- [ ] Karteikarten-Import/Export als CSV
- [ ] Drag & Drop zum Sortieren von Aufgaben im Lernplan
- [ ] Ladeanimation verbessern (Skeleton Screens statt Spinner)

---

## 💳 Abo & Monetarisierung

- [ ] Stripe-Integration für echte Zahlungen (aktuell nur UI)
- [ ] Free-Tier Limit: max. 3 KI-Anfragen/Tag ohne Abo
- [ ] Schüler-Rabatt (Email-Verifikation mit Schul-Domäne)

---

## 🛠️ Technisch

- [ ] Karteikarten-Sync vollständig in Supabase (aktuell nur localStorage)
- [ ] Aufgaben und Prüfungsergebnisse in Supabase speichern
- [ ] E-Mail-Bestätigung nach Registrierung aktivieren (Supabase Auth Setting)
- [ ] Supabase Realtime: Eltern-Dashboard aktualisiert sich live wenn Kind lernt
- [ ] Rate-Limiting in Edge Function pro User (nicht nur pro Browser-Tab)
- [ ] Automatische Session-Verlängerung (Supabase Auth Refresh Token)

---

## 🐛 Bekannte Bugs / kleinere Fixes

- [ ] Nach Passwort-Reset: App landet auf /app.html#reset-password — neues Passwort-Formular noch nicht implementiert
- [ ] Kind-Streak wird nicht via Supabase `update_child_stats` gespeichert (PIN nicht in Session — Workaround nötig)
