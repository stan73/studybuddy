# StudyBuddy Pro — Phase 2 Masterplan
**Erstellt:** 2026-04-04
**Status:** Archiviert (2026-09-02) — siehe Hinweis unten; aktueller Stand in `BACKLOG.md`
**Repo:** github.com/stan73/studybuddy
**Live:** gleaming-gaufre-b15c11.netlify.app (Backend: **Neon**)

---

> ## ⚠️ Backend-Migration Supabase → Neon (2026-07-16)
> Das gesamte Backend wurde von **Supabase** auf **Neon** (Serverless Postgres, `eu-central-1`/Frankfurt, DSGVO) migriert. Konkret:
> - **Auth:** Supabase Auth → **Neon Auth** (Better-Auth-kompatibel). Bestehende User registrieren sich neu (Supabase-Passwort-Hashes lassen sich nicht migrieren); die Netlify Function `link-profile` verknüpft die Daten eines migrierten Users beim ersten Login/Signup per E-Mail automatisch mit der neuen Neon-Auth-ID.
> - **Datenzugriff:** Supabase-Client → **Neon Data API** (PostgREST-kompatibel) via `@neondatabase/neon-js`, hinter einer Supabase-kompatiblen Fassade in `js/vendor/neon-client.js` — Aufrufstellen (`sb.from()/.rpc()/.auth.*`) bleiben unverändert. RLS weiterhin über `auth.uid()` (nativ via Neon Auth `pg_session_jwt`).
> - **Serverless-Funktionen:** Supabase Edge Functions → **Netlify Functions** (`netlify/functions/ai-proxy.mjs`, `netlify/functions/link-profile.mjs`). Die ungenutzte Edge Function `bright-worker` ist entfallen.
> - **Env-Vars (Netlify):** `DATABASE_URL` (Neon-Owner-Conn) + `NEON_JWKS_URL`; kein `SUPABASE_URL`/`SUPABASE_ANON_KEY` mehr.
> - Schema/RPCs/RLS (10 Tabellen, 10 RPCs) wurden **1:1 auf Neon re-portiert**. Der Ordner `supabase/migrations/` ist ab jetzt **nur noch historisch**. Das alte Supabase-Projekt `qzmviwrpyfpjahcmbjoy` bleibt nur als ruhendes Backup bestehen.
>
> Die untenstehenden Supabase-Passagen (Stufe 3 etc.) bleiben als **historischer Umsetzungsstand** erhalten und sind entsprechend gekennzeichnet.

---

## Ziel
Phase 2 transformiert das Single-HTML-SPA in eine professionelle, sicherheitskonforme Multi-File-Architektur mit echtem Backend (**Neon** — Serverless Postgres, Frankfurt; ursprünglich Supabase, migriert 2026-07-16), Cyber Resilience Act (CRA)-konformer Absicherung und erweitertem Eltern-Dashboard.

---

## Checkpoint-System
Bei jeder Unterbrechung: zuletzt abgehakter Schritt = Wiedereintrittspunkt.

---

## STUFE 1 — Projektstruktur & Security Headers
**Ziel:** Sauber aufgeräumtes Repo, Netlify-Security-Headers, kein monolithisches HTML mehr.

### Neue Verzeichnisstruktur
```
studybuddy/
├── netlify.toml          ← Build-Config + Security Headers (CSP, HSTS, etc.)
├── _redirects            ← SPA Fallback: /* /index.html 200
├── index.html            ← Landing Page (statisch, kein JS-App-Code)
├── app.html              ← App-Shell (authentifiziert, lädt JS-Module)
├── css/
│   ├── variables.css     ← Design Tokens (Farben, Schriften, Spacing)
│   ├── base.css          ← Reset, Typografie, globale Styles
│   ├── components.css    ← Buttons, Cards, Forms, Toast, Modal
│   └── layout.css        ← Sidebar, Header, Grid, Responsive
├── js/
│   ├── config.js         ← Konstanten, API-Endpoints, App-Config
│   ├── supabase.js       ← Supabase Client Initialisierung
│   ├── auth.js           ← Login, Register, Logout, Session-Check
│   ├── state.js          ← Globaler App-State (kein direktes localStorage)
│   ├── router.js         ← Clientseitiges SPA-Routing (hash-based)
│   ├── api/
│   │   ├── claude.js     ← Claude API Wrapper (Haiku, Budget-bewusst)
│   │   └── db.js         ← Supabase CRUD-Operationen
│   ├── pages/
│   │   ├── dashboard.js
│   │   ├── subjects.js
│   │   ├── flashcards.js
│   │   ├── tutor.js
│   │   ├── exams.js
│   │   ├── planner.js
│   │   ├── pomodoro.js
│   │   ├── parent.js
│   │   └── settings.js
│   └── utils/
│       ├── sanitize.js   ← DOMPurify Wrapper (XSS-Schutz)
│       └── storage.js    ← Sicherer Storage (kein Klartext-Passwort, etc.)
├── docs/
│   ├── SECURITY.md       ← CRA: Vulnerability Disclosure Policy
│   ├── SBOM.json         ← CRA: Software Bill of Materials
│   └── PRIVACY.md        ← DSGVO Datenschutzerklärung
└── supabase/
    └── schema.sql        ← Datenbankschema + RLS Policies
```

**Status:** [ ] Noch nicht implementiert

---

## STUFE 2 — Security Headers (netlify.toml)
**Ziel:** CRA + OWASP Top 10 Compliance auf Netzwerkebene.

### Headers die gesetzt werden:
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://api.anthropic.com https://*.neon.tech https://esm.sh /.netlify/functions/;
  img-src 'self' data: https:;
  frame-ancestors 'none';

X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**Status:** [ ] Noch nicht implementiert

---

## STUFE 3 — Supabase Backend

> **Historisch — jetzt auf Neon.** Dieses Schema/RLS wurde 1:1 nach Neon re-portiert (siehe Migrations-Hinweis oben); die folgenden Supabase-Schritte dokumentieren nur den ursprünglichen Umsetzungsstand.

### 3.1 Benutzer-Aktion erforderlich (einmalig)
Der User muss:
1. Auf https://supabase.com gehen → "New Project"
2. Projekt-Name: `studybuddy-pro`
3. Datenbank-Passwort: sicher generieren + speichern
4. Region: `eu-central-1` (Frankfurt, DSGVO-konform)
5. Project URL + anon public key → in `js/config.js` eintragen

### 3.2 Datenbankschema (supabase/schema.sql)
```sql
-- Profiles (erweitert Supabase Auth)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT CHECK (role IN ('student','parent','teacher')) NOT NULL,
  grade INTEGER CHECK (grade BETWEEN 5 AND 13),
  school TEXT,
  api_key TEXT,  -- verschlüsselt gespeichert
  subscription TEXT DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Kinder (für Eltern-Accounts)
CREATE TABLE children (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  grade INTEGER CHECK (grade BETWEEN 5 AND 13),
  school TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Karteikarten
CREATE TABLE cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  level INTEGER DEFAULT 0 CHECK (level BETWEEN 0 AND 4),
  due_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lernsessions
CREATE TABLE sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  subject TEXT,
  duration_minutes INTEGER,
  xp_earned INTEGER DEFAULT 0,
  session_type TEXT CHECK (session_type IN ('flashcard','exam','tutor','pomodoro')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prüfungen
CREATE TABLE exams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  score INTEGER,
  total INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Aufgaben
CREATE TABLE tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT,
  due_at TIMESTAMPTZ,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- XP & Streak (denormalisiert für Performance)
CREATE TABLE user_stats (
  user_id UUID REFERENCES profiles(id) PRIMARY KEY,
  xp INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  last_study_at TIMESTAMPTZ,
  total_correct INTEGER DEFAULT 0,
  total_answered INTEGER DEFAULT 0
);
```

### 3.3 Row Level Security (RLS) — kritisch für CRA
```sql
-- Jeder User sieht nur seine eigenen Daten
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;

-- Policies (Beispiel für cards):
CREATE POLICY "Users can only see own cards"
  ON cards FOR ALL
  USING (auth.uid() = user_id);

-- Eltern können Kinder-Daten sehen
CREATE POLICY "Parents can read children data"
  ON sessions FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM profiles WHERE id IN (
        SELECT child_id FROM children WHERE parent_id = auth.uid()
      )
    )
  );
```

**Status:** [ ] Schema-File geschrieben
**Status:** [ ] User hat Supabase-Projekt erstellt
**Status:** [ ] Credentials in config.js eingetragen

---

## STUFE 4 — JavaScript Module — **NICHT UMGESETZT, verworfen 2026-09-02**

> Die Module `js/config.js`, `js/auth.js`, `js/state.js`, `js/router.js`, `js/api/db.js`, `js/utils/*` wurden zwar angelegt, aber **nie in `app.html`/`index.html` eingebunden**. Sie existierten als toter Parallelcode mit abweichender Logik (andere Streak-Regel, andere Schulformenliste, anderer Weg der Profilanlage) und wurden in Commit `2c12a66` gelöscht. Die App bleibt bewusst zweidateig (`index.html` + `app.html`) mit Vendor-Bibliotheken unter `js/vendor/`. Der folgende Abschnitt ist nur noch Planungshistorie.


### 4.1 js/config.js
- Supabase URL + anon key
- Claude API Modell: `claude-haiku-4-5-20251001`
- App-Konstanten (Fächer, Klassen, Subscription-Tiers)

### 4.2 js/auth.js
- `signIn(email, password)` → Supabase Auth
- `signUp(email, password, profile)` → Auth + Profil anlegen
- `signOut()` → Session beenden
- `getSession()` → aktuellen User holen
- `onAuthStateChange(callback)` → reaktiv

### 4.3 js/api/db.js
- CRUD für alle Tabellen
- Fehlerbehandlung mit Typen
- Optimistic Updates wo möglich

### 4.4 js/api/claude.js  (Budget-bewusst)
- Zentrales Rate-Limiting (max. 3 Requests/Minute)
- Response-Caching (sessionStorage, 15 Minuten)
- Prompt-Optimierung für kürzere Tokens
- Nur claude-haiku (günstigstes Modell)

### 4.5 js/utils/sanitize.js
- DOMPurify CDN einbinden
- Alle User-Inputs durch `sanitize()` führen
- HTML-Injection verhindern

**Status:** [ ] Alle Module implementiert

---

## STUFE 5 — Parent Dashboard (Chart.js)
- Wochenübersicht: Lernzeit pro Tag (Balkendiagramm)
- Fachverteilung (Kuchendiagramm)
- Karteikarten-Fortschritt pro Kind
- Lernstreak-Kalender
- Export als PDF (optional Phase 3)

**Status:** [ ] Noch nicht implementiert

---

## STUFE 6 — CRA Compliance Dokumentation

### Cyber Resilience Act (EU) Anforderungen:
1. **SBOM** (Software Bill of Materials) → `docs/SBOM.json`
   - Alle externen Abhängigkeiten mit Version + Lizenz
2. **Vulnerability Disclosure Policy** → `docs/SECURITY.md`
   - Kontakt-E-Mail für Sicherheitsmeldungen
   - Antwortzeit-SLA
3. **Secure by Default** → bereits durch CSP + RLS abgedeckt
4. **Keine Default-Passwörter** → Supabase generiert sichere Tokens
5. **Verschlüsselung** → HTTPS (Netlify), Supabase at-rest encryption

### DSGVO Anforderungen:
- Datenschutzerklärung → `docs/PRIVACY.md`
- Recht auf Löschung → Account-Delete-Funktion in Settings
- Datenminimierung → nur notwendige Felder speichern
- EU-Datenresidenz → Supabase Frankfurt (eu-central-1)

**Status:** [ ] Dokumentation geschrieben

---

## Budget-Optimierung Claude API

| Feature | Tokens (ca.) | Frequenz | Kosten/Monat* |
|---------|-------------|----------|--------------|
| Karteikarten generieren | ~800 | selten | minimal |
| KI-Tutor Antwort | ~400 | mittel | ~€0.50 |
| Prüfungsfragen | ~1200 | selten | minimal |
| **Gesamt** | | | **< €2/Monat** |

*Bei moderater Nutzung, Haiku-Modell

**Sparmaßnahmen:**
- Response-Caching (gleiche Anfragen nicht doppelt senden)
- Rate-Limiting im Frontend
- Maximale Token-Limits strikt einhalten
- Demo-Inhalte lokal vorgeneriert (kein API-Call nötig)

---

## Implementierungsreihenfolge (Checkpoint-basiert)

- [x] **CP-00** Masterplan geschrieben
- [ ] **CP-01** netlify.toml + _redirects + _headers
- [ ] **CP-02** CSS aufgeteilt: variables + base + components + layout
- [ ] **CP-03** js/config.js + js/utils/sanitize.js
- [ ] **CP-04** index.html (Landing, statisch, sauber)
- [ ] **CP-05** app.html (App-Shell, lädt Module)
- [ ] **CP-06** js/auth.js (Supabase Auth)
- [ ] **CP-07** js/api/db.js (Supabase CRUD)
- [ ] **CP-08** js/api/claude.js (Budget-bewusst, gecacht)
- [ ] **CP-09** js/state.js + js/router.js
- [ ] **CP-10** js/pages/* (alle Seiten als Module)
- [ ] **CP-11** Parent Dashboard mit Chart.js
- [ ] **CP-12** supabase/schema.sql
- [ ] **CP-13** docs/SECURITY.md + docs/SBOM.json + docs/PRIVACY.md
- [ ] **CP-14** Git commit + push + Deploy verifizieren

---

## Nächste Benutzer-Aktion (wann CP-06 erreicht)
1. https://supabase.com → New Project → Frankfurt
2. Project URL + anon key → mir mitteilen
3. SQL aus supabase/schema.sql im Supabase SQL Editor ausführen

---
*Letzter Update: 2026-07-16 (Backend-Migration Supabase → Neon; ursprünglich erstellt 2026-04-04)*
