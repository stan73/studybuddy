# Security Policy — StudyBuddy Pro

## Cyber Resilience Act (CRA) Compliance

StudyBuddy Pro ist nach den Anforderungen des EU Cyber Resilience Act (CRA 2024/2847) entwickelt.

## Sicherheitsmaßnahmen

### Authentifizierung & Autorisierung
- **Neon Auth** (Better-Auth-kompatibel; seit 2026-07-16, zuvor Supabase Auth)
- Mindest-Passwortanforderungen: 8 Zeichen, 1 Zahl, 1 Großbuchstabe
- Profil-Verknüpfung (`netlify/functions/link-profile.mjs`): Die E-Mail stammt ausschließlich aus `neon_auth."user"` (kein Client-Wert); ein bestehendes Profil wird nur dann auf eine neue Auth-ID umgehängt, wenn die E-Mail des Auth-Kontos verifiziert ist (sonst 403)
- Offen (Stand 2026-09-02): `require_email_verification`/`verify_email_on_sign_up` in der Neon-Auth-Config sind noch aus; Voraussetzung dafür ist eine OTP-Eingabe im Client (`email_verification_method: otp`). Bis dahin verifiziert der Betreiber migrierte Konten manuell (`neon/migrations/003_…`)
- Row Level Security (RLS) auf Datenbankebene, durchgesetzt über `auth.uid()` (nativ via Neon Auth `pg_session_jwt`)
- KI-Provider-Keys (Claude/OpenAI/Gemini): Der Elternteil trägt den Key einmalig in den Einstellungen ein; der Browser testet ihn über den Proxy und legt ihn per Data-API in `api_keys` ab (RLS: Client-Rollen dürfen nur INSERT/UPDATE/DELETE auf eigene Zeilen, **kein SELECT**). Danach kann der Browser den Key nicht mehr aus der Datenbank lesen — jede KI-Anfrage schickt nur das Auth-JWT, und die Netlify Function `ai-proxy` (`netlify/functions/ai-proxy.mjs`) löst den Key serverseitig auf und reicht ihn an den Anbieter weiter
- Bekannte Einschränkung (Stand 2026-09): Der eingegebene Key wird zusätzlich in `localStorage` des Eltern-Geräts abgelegt, damit Kind-Profile auf demselben Gerät ihn erben können. Diese Ablage wird in einer späteren Härtungsstufe abgelöst

### Datenbank-Funktionen (Neon, Schema `public`)
- Alle 8 `SECURITY DEFINER`-Funktionen (`auth_child`, `consume_ai_quota`, `get_configured_providers`, `load_child_data`, `load_my_data`, `sync_child_data`, `sync_my_data`, `update_child_stats`) tragen `SET search_path = public, pg_temp` — `pg_temp` explizit am Ende, damit temporäre Objekte des Aufrufers die Tabellenauflösung nicht kapern können (`neon/migrations/004`, `005`)
- `SECURITY DEFINER` umgeht RLS; die Rümpfe der Eltern-RPCs sind deshalb strikt auf `auth.uid()` eingegrenzt (kein `user_id` aus dem Payload), EXECUTE nur für `authenticated`
- Kind-RPCs (`auth_child`, `*_child_data`, `update_child_stats`) sind für `anonymous` ausführbar (PIN-Login ohne Konto) — PIN-Handling ist ein offener Härtungspunkt (1.5)
- Vorfall 2026-07-16 → 2026-09-02: `sync_my_data`/`load_my_data` liefen nach der Neon-Migration als `SECURITY INVOKER` und scheiterten mit 42501 — die Eltern-Persistenz war in dieser Zeit ohne Fehlermeldung außer Betrieb (`neon/migrations/004`)

### KI-Proxy (`netlify/functions/ai-proxy.mjs`)
- Kind-Pfad nur mit HMAC-SHA256-signiertem, 12 h gültigem Kind-Token (`netlify/functions/child-token.mjs`, ausgestellt nach PIN-Prüfung via `auth_child`); Schlüssel `CHILD_TOKEN_SECRET` liegt ausschließlich in der Netlify-Umgebung. Fehlt er, verweigert der Kind-Pfad den Dienst — kein Rückfall auf ungeprüfte Anfragen
- Serverseitige Grenzen unabhängig vom Client: `max_tokens` ≤ 2000, ≤ 40 Nachrichten / 60 000 Zeichen, Bilder/PDF ≤ 4 MB (Base64 ≤ 5,6 M Zeichen, MIME-Allowlist), 20 s Upstream-Timeout (AbortController)
- CORS nur für eigene Origins (`netlify/functions/_lib/cors.mjs`, erweiterbar per Env `ALLOWED_ORIGINS`)
- `consume_ai_quota()` ist nur noch für den DB-Owner ausführbar (kein `PUBLIC`/`anonymous`/`authenticated`)
- Function-Timeout: Netlify-Default 10 s; ein höheres Limit ist nicht in `netlify.toml` konfigurierbar, sondern nur über Netlify UI/Support (Pro-Plan, bis 26 s)

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
| 2.2.0 | 2026-09-02 | Härtung Stufe 0/1: Konto-Übernahme via link-profile geschlossen, KI-Keys nur serverseitig, Kind-Token im ai-proxy, Session-Gate, Passwort-Reset, Eltern-Persistenz repariert (SECURITY DEFINER), search_path bei allen DEFINER-Funktionen, toter Parallelcode entfernt, CI als Deploy-Tor. Versionsquelle: package.json |
| 2.1.0 | 2026-07-16 | Backend-Migration Supabase → Neon (Neon Auth, Neon Data API, Netlify Functions; EU/Frankfurt) |
| 2.0.0 | 2026-04-04 | Phase 2: Multi-File-Struktur, Security Headers, RLS |
| 1.0.0 | 2026-03-01 | Phase 1: Initial Release |
