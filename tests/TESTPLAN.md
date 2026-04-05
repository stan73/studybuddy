# StudyBuddy Pro — Testplan
> **Version:** 2.0 · **Erstellt:** 2026-04-05
> **Automatischer Test:** `node tests/run_tests.js` (155 Tests)
> **Manueller Test:** Diese Datei, Schritt für Schritt im Browser
> **URL:** https://gleaming-gaufre-b15c11.netlify.app

---

## Regel: Wann muss getestet werden?

| Änderungstyp | Automatisch | Manuell |
|---|---|---|
| Bugfix in bestehender Funktion | ✅ Pflicht | Betroffene Sektion |
| Neue Funktion / neues Feature | ✅ Pflicht + neue Tests hinzufügen | Vollständige Sektion |
| Funktion entfernt | ✅ Pflicht + Test entfernen | Alle abhängigen Sektionen |
| CSS/Style-Änderung | – | T10 (Struktur) |
| Supabase-Schema-Änderung | ✅ T11 | T-M7 (Auth) |

---

## M1 — Auth-Flow

### M1.1 Normaler Login
1. → `gleaming-gaufre-b15c11.netlify.app`
2. E-Mail + Passwort eingeben → "Anmelden"
3. **Erwartet:** Weiterleitung zu `app.html`, Dashboard sichtbar, Name in Sidebar

### M1.2 Registrierung
1. "Konto erstellen" → Formular ausfüllen → Absenden
2. **Erwartet:** Bestätigungsmail oder Direktanmeldung (je nach Supabase-Config)

### M1.3 Demo-Modus
1. "Demo ausprobieren" klicken
2. **Erwartet:** App öffnet sich, "Demo" in Sidebar, Lernfortschritte nicht persistent

### M1.4 Kind-Login
1. "Als Kind einloggen" → Eltern-E-Mail + Kindname + PIN eingeben
2. **Erwartet:** Kind-Dashboard, keine Einstellungs-Seite für API-Keys

### M1.5 Logout
1. Sidebar → "Abmelden" → Bestätigung "Ja"
2. **Erwartet:** Weiterleitung zu `/`, localStorage geleert, kein AI-State mehr

### M1.6 Logout abbrechen
1. Sidebar → "Abmelden" → "Abbrechen"
2. **Erwartet:** Nutzer bleibt eingeloggt, kein Redirect

---

## M2 — Navigation

### M2.1 Alle Menüpunkte
Für jeden Punkt: Dashboard, Fächer, Karteikarten, KI-Tutor, Prüfungsmodus, Lernplan, Pomodoro, Einstellungen:
1. In Sidebar klicken
2. **Erwartet:** Seite lädt ohne JS-Fehler, Seitentitel im Header korrekt

### M2.2 Eltern-spezifische Navigation
1. Als Elternteil einloggen
2. **Erwartet:** "Eltern-Übersicht" und "Kinder" sichtbar in Sidebar

### M2.3 Back-Button (Browser)
1. Seite wechseln → Browser-Zurück-Button
2. **Erwartet:** App funktioniert weiterhin (kein Weißbild)

---

## M3 — Dashboard

### M3.1 Statistiken
1. Dashboard öffnen
2. **Erwartet:** XP, Streak, fällige Karten, offene Aufgaben korrekt angezeigt

### M3.2 Schnellstart-Buttons
1. Jeden der 4 Buttons klicken (Karteikarten, KI-Tutor, Prüfung, Pomodoro)
2. **Erwartet:** Jeweilige Seite öffnet sich

### M3.3 Aufgaben-Checkbox
1. Aufgabe im Dashboard abhaken
2. **Erwartet:** Toast "Aufgabe erledigt", Checkbox bleibt aktiv nach Seitenwechsel

---

## M4 — Karteikarten

### M4.1 Manuelle Karte hinzufügen
1. Karteikarten-Seite → Vorderseite + Rückseite ausfüllen → "Karte hinzufügen"
2. **Erwartet:** Toast "Karte hinzugefügt ✓", Karte erscheint im Stapel

### M4.2 Validierung: leere Felder
1. Nur Vorderseite ausfüllen → "Karte hinzufügen"
2. **Erwartet:** Toast "Vorder- und Rückseite ausfüllen!"

### M4.3 Karte aufdecken
1. Auf Karteikarte klicken
2. **Erwartet:** Karte dreht sich (Vorderseite → Rückseite), Bewertungs-Buttons erscheinen

### M4.4 Spaced-Repetition-Bewertung
1. Karte aufdecken → "Leicht" / "Ok" / "Schwer" / "Falsch" wählen
2. **Erwartet:** Nächste Karte erscheint, XP-Update, Level-Änderung korrekt

### M4.5 Fach-Wechsel
1. Dropdown-Fach wechseln
2. **Erwartet:** Richtige Karten für das Fach angezeigt

### M4.6 KI-Karten generieren (mit API-Key)
1. Text in "KI-Generierung" eingeben → Anzahl wählen → "🤖 KI-Karten erstellen"
2. **Erwartet:** Toast "🎉 X Karten erstellt!", Karten im Stapel

### M4.7 KI-Karten ohne API-Key
1. Ohne API-Key: Text eingeben → "🤖 KI-Karten erstellen"
2. **Erwartet:** Toast "API Key in Einstellungen eintragen!"

### M4.8 Alle Karten gelernt
1. Alle fälligen Karten bewerten
2. **Erwartet:** "Alle Karten für heute gelernt!"-Nachricht

---

## M5 — KI-Tutor

### M5.1 Chat mit API-Key
1. KI-Tutor öffnen → Frage eingeben → Senden oder Enter
2. **Erwartet:** "✍️ Tutor tippt…" erscheint, Antwort kommt, Indikator verschwindet

### M5.2 Chat ohne API-Key
1. Ohne API-Key: Frage senden
2. **Erwartet:** Toast "API Key in Einstellungen eintragen!"

### M5.3 Fach-Wechsel im Tutor
1. Fach-Dropdown wechseln
2. **Erwartet:** Tutor antwortet im Kontext des neuen Faches

### M5.4 Fehlerbehandlung
1. Ungültigen Key → Nachricht senden
2. **Erwartet:** Rote Fehlermeldung im Chat, kein "Tutor tippt…" hängt

---

## M6 — Prüfungsmodus

### M6.1 Start ohne API-Key (Fallback)
1. Prüfungsmodus → Fach wählen → "🚀 Prüfung starten"
2. **Erwartet:** Echte Lernfragen erscheinen (KEIN "Option A/B/C/D")

### M6.2 Antwort wählen
1. Frage klicken → Antwort-Button wählen
2. **Erwartet:** Richtige Antwort grün, falsche rot + richtige grün, nächste Frage nach 1,2s

### M6.3 Doppelklick-Schutz
1. Sehr schnell doppelklicken
2. **Erwartet:** Nur erste Antwort zählt, keine Frage wird übersprungen

### M6.4 Prüfung abschließen
1. Alle Fragen beantworten
2. **Erwartet:** Ergebnis-Screen mit Prozent + Emoji, XP vergeben

### M6.5 "Nochmal"-Button
1. Ergebnis-Screen → "Nochmal"
2. **Erwartet:** Zurück zur Startseite des Prüfungsmodus (nicht direkt Prüfungsstart)

### M6.6 Prüfung mit API-Key (KI-Fragen)
1. Gültigen API-Key setzen → Prüfung starten
2. **Erwartet:** KI generiert Fragen, Status zeigt "✓ KI-Modus aktiv"

---

## M7 — Lernplan

### M7.1 Aufgabe hinzufügen
1. Titel + Fach + Datum → "Aufgabe hinzufügen"
2. **Erwartet:** Aufgabe erscheint in der Liste, Toast "✅ Aufgabe hinzugefügt!"

### M7.2 Aufgabe ohne Titel
1. Nur Fach wählen → "Aufgabe hinzufügen"
2. **Erwartet:** Toast "Titel eingeben!"

### M7.3 Aufgabe abhaken
1. Checkbox bei Aufgabe anklicken
2. **Erwartet:** Aufgabe als erledigt markiert, bleibt persistent

### M7.4 Aufgabe löschen
1. "✕"-Button bei Aufgabe
2. **Erwartet:** Aufgabe aus Liste entfernt

---

## M8 — Pomodoro-Timer

### M8.1 Start/Pause
1. "▶ Start" → läuft → "⏸ Pause"
2. **Erwartet:** Timer läuft korrekt, Pause stoppt ihn

### M8.2 Reset
1. Timer läuft → "↺ Reset"
2. **Erwartet:** Timer zurück auf Ausgangszeit, nicht mehr laufend

### M8.3 Fokus-Ende
1. Timer bis 00:00 laufen lassen (oder kurze Testzeit einstellen)
2. **Erwartet:** Toast "🎉 Fokus-Session geschafft! +X XP. Pause!", Wechsel zu Pause

### M8.4 Konfiguration
1. Fokus-/Pause-Zeit ändern (Input-Felder)
2. **Erwartet:** Neuer Wert wird beim nächsten Reset verwendet

---

## M9 — Einstellungen

### M9.1 Profil speichern
1. Name ändern → "Profil speichern"
2. **Erwartet:** Toast "✅ Profil gespeichert!", Name in Sidebar aktualisiert

### M9.2 Falschen API-Key (falsche Präfix) eingeben
1. "abc123" bei Claude eingeben → Speichern
2. **Erwartet:** Toast "Ungültiger Key — muss mit sk-ant- beginnen"

### M9.3 Anbieter-Verwechslung
1. Anthropic-Key (`sk-ant-…`) bei OpenAI eingeben → Speichern
2. **Erwartet:** Toast "Das ist ein Anthropic/Claude Key!"

### M9.4 Gültigen API-Key testen
1. Echten Key eingeben → Speichern
2. **Erwartet:** "⏳ Teste Verbindung…" erscheint, dann "✅ verbunden!", Badge "aktiv"

### M9.5 Ungültigen Key (korrekte Präfix, aber falsch)
1. `sk-ant-fakekey` eingeben → Speichern
2. **Erwartet:** "❌ Verbindung fehlgeschlagen: …", Key NICHT als aktiv markiert

### M9.6 Lernfortschritte löschen
1. "Alle Lernfortschritte löschen" → Bestätigen
2. **Erwartet:** Toast "Daten gelöscht!", Dashboard auf 0

---

## M10 — Aktivitäts-Log

### M10.1 Log öffnen
1. 📋-Button im Header klicken
2. **Erwartet:** Drawer öffnet von rechts, Einträge mit Datum/Uhrzeit sichtbar

### M10.2 Toast erscheint im Log
1. Aktion ausführen (z.B. Karte hinzufügen) → Log öffnen
2. **Erwartet:** Neuer Eintrag mit korrekter Zeit und Typ (grün/rot/gelb)

### M10.3 Filter
1. "❌ Fehler" klicken
2. **Erwartet:** Nur Fehler-Einträge sichtbar

### M10.4 Fehler-Badge
1. Fehler provozieren (falschen API-Key speichern) → Log schließen
2. **Erwartet:** Roter Badge mit Zahl auf 📋-Button

### M10.5 Badge verschwindet nach Öffnen
1. Badge sichtbar → Log öffnen → schließen
2. **Erwartet:** Badge weg

### M10.6 Log löschen
1. "🗑 Löschen" → Bestätigen
2. **Erwartet:** Log leer, "📭 Noch keine Einträge"

### M10.7 ESC schließt Drawer
1. Log öffnen → ESC drücken
2. **Erwartet:** Drawer schließt sich

### M10.8 Backdrop schließt Drawer
1. Log öffnen → außerhalb klicken
2. **Erwartet:** Drawer schließt sich

---

## M11 — Eltern-Dashboard & Kinder

### M11.1 Kind hinzufügen
1. Kinder-Seite → Name + Klasse + PIN → "Kind hinzufügen"
2. **Erwartet:** Toast "✅ [Name] hinzugefügt! PIN: XXXX", Kind in Liste

### M11.2 Validierung PIN
1. Nur 3-stellige PIN eingeben
2. **Erwartet:** Toast "PIN muss genau 4 Ziffern haben!"

### M11.3 PIN ändern
1. Neue PIN eingeben → "PIN ändern"
2. **Erwartet:** Toast "✅ PIN aktualisiert!"

### M11.4 Kind entfernen
1. "✕"-Button bei Kind → Bestätigen
2. **Erwartet:** Kind aus Liste entfernt

### M11.5 Eltern-Dashboard
1. Eltern-Übersicht öffnen
2. **Erwartet:** Statistiken für alle Kinder sichtbar (XP, Streak, Karten)

---

## M12 — PWA & Offline

### M12.1 PWA installierbar
1. Browser-Adressleiste → Installieren-Icon (Chrome)
2. **Erwartet:** App lässt sich als PWA installieren

### M12.2 Offline-Verhalten
1. Netzwerk deaktivieren → App neu laden
2. **Erwartet:** App lädt aus Cache (Service Worker), grundlegende Funktionen verfügbar

---

## Testergebnis-Vorlage

```
Datum: ___________  Tester: ___________  Version/Commit: ___________

Automatische Tests: node tests/run_tests.js
→ Ergebnis: ___/155 bestanden

Manuelle Tests:
[ ] M1 Auth          ✅ / ❌ / ⚠️  Anmerkung: ___
[ ] M2 Navigation    ✅ / ❌ / ⚠️  Anmerkung: ___
[ ] M3 Dashboard     ✅ / ❌ / ⚠️  Anmerkung: ___
[ ] M4 Karteikarten  ✅ / ❌ / ⚠️  Anmerkung: ___
[ ] M5 KI-Tutor      ✅ / ❌ / ⚠️  Anmerkung: ___
[ ] M6 Prüfungsmodus ✅ / ❌ / ⚠️  Anmerkung: ___
[ ] M7 Lernplan      ✅ / ❌ / ⚠️  Anmerkung: ___
[ ] M8 Pomodoro      ✅ / ❌ / ⚠️  Anmerkung: ___
[ ] M9 Einstellungen ✅ / ❌ / ⚠️  Anmerkung: ___
[ ] M10 Log          ✅ / ❌ / ⚠️  Anmerkung: ___
[ ] M11 Eltern/Kinder ✅ / ❌ / ⚠️  Anmerkung: ___
[ ] M12 PWA/Offline  ✅ / ❌ / ⚠️  Anmerkung: ___

Gesamt: ___/12 Sektionen bestanden
Offene Bugs: ___
```
