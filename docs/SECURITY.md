# Security Policy — StudyBuddy Pro

## Cyber Resilience Act (CRA) Compliance

StudyBuddy Pro ist nach den Anforderungen des EU Cyber Resilience Act (CRA 2024/2847) entwickelt.

## Sicherheitsmaßnahmen

### Authentifizierung & Autorisierung
- Supabase Auth mit bcrypt-Passwort-Hashing
- Mindest-Passwortanforderungen: 8 Zeichen, 1 Zahl, 1 Großbuchstabe
- Row Level Security (RLS) auf Datenbankebene
- API Keys nur im Browser-Memory, nie persistiert

### Netzwerksicherheit
- HTTPS-Only (HSTS)
- Content Security Policy (CSP)
- X-Frame-Options: DENY
- Referrer-Policy: strict-origin-when-cross-origin

### Datenschutz (DSGVO)
- Serverstandort: EU (Frankfurt, eu-central-1)
- Verschlüsselung at-rest (Supabase)
- Recht auf Löschung implementiert
- Keine Weitergabe an Dritte

### XSS-Schutz
- DOMPurify für alle User-Inputs
- Keine direkte innerHTML-Verwendung mit User-Daten
- CSP verhindert Inline-Script-Injection

## Vulnerability Disclosure Policy

Wenn du eine Sicherheitslücke findest, melde sie bitte vertraulich:

**E-Mail:** security@studybuddy.pro
**PGP:** (Key wird nach Produktionsstart veröffentlicht)

**Antwortzeit:** Innerhalb von 72 Stunden
**Fix-Frist:** Kritische Schwachstellen innerhalb von 30 Tagen

Bitte keine öffentliche Offenlegung vor Bestätigung des Fixes.

## Bekannte Einschränkungen (Phase 2)

- Zahlungsabwicklung noch nicht aktiv (Phase 3)
- Keine 2-Faktor-Authentifizierung (geplant für Phase 3)
- API Keys im Browser-Memory (bewusste Entscheidung: kein Backend-Proxy in Phase 2)

## Versionsverlauf

| Version | Datum | Änderungen |
|---------|-------|-----------|
| 2.0.0 | 2026-04-04 | Phase 2: Multi-File-Struktur, Security Headers, RLS |
| 1.0.0 | 2026-03-01 | Phase 1: Initial Release |
