# Security Policy — StudyBuddy Pro

## Cyber Resilience Act (CRA) Compliance

StudyBuddy Pro ist nach den Anforderungen des EU Cyber Resilience Act (CRA 2024/2847) entwickelt.

## Sicherheitsmaßnahmen

### Authentifizierung & Autorisierung
- **Neon Auth** (Better-Auth-kompatibel; seit 2026-07-16, zuvor Supabase Auth)
- Mindest-Passwortanforderungen: 8 Zeichen, 1 Zahl, 1 Großbuchstabe
- Row Level Security (RLS) auf Datenbankebene, durchgesetzt über `auth.uid()` (nativ via Neon Auth `pg_session_jwt`)
- KI-Provider-Keys nie im Browser: gekapselt in der Netlify Function `ai-proxy` (`netlify/functions/ai-proxy.mjs`); der Client sieht die Keys nie

### Netzwerksicherheit
- HTTPS-Only (HSTS)
- Content Security Policy (CSP)
- X-Frame-Options: DENY
- Referrer-Policy: strict-origin-when-cross-origin

### Datenschutz (DSGVO)
- Serverstandort: EU (Frankfurt, `eu-central-1`) — **Neon** Serverless Postgres
- Verschlüsselung at-rest (Neon)
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
- KI-Provider-Keys serverseitig gekapselt in der Netlify Function `ai-proxy` (nicht mehr im Browser-Memory)

## Versionsverlauf

| Version | Datum | Änderungen |
|---------|-------|-----------|
| 2.1.0 | 2026-07-16 | Backend-Migration Supabase → Neon (Neon Auth, Neon Data API, Netlify Functions; EU/Frankfurt) |
| 2.0.0 | 2026-04-04 | Phase 2: Multi-File-Struktur, Security Headers, RLS |
| 1.0.0 | 2026-03-01 | Phase 1: Initial Release |
