/**
 * StudyBuddy Pro — Neon-Client-Bootstrap (ersetzt js/vendor/supabase.js)
 *
 * Stellt einen Supabase-kompatiblen Client auf Basis von @neondatabase/neon-js
 * bereit. Der SupabaseAuthAdapter erhält die vertraute Supabase-Auth-API
 * (signInWithPassword, signUp, getSession, signOut, getUser ...), sodass die
 * bestehenden Aufrufstellen in app.html / index.html unverändert bleiben.
 *
 * Datenzugriff (from/select/insert/update/delete/rpc) läuft PostgREST-kompatibel
 * über die Neon Data API; das Better-Auth-JWT wird bei angemeldeten Nutzern
 * automatisch als Authorization: Bearer mitgesendet.
 *
 * Dieses Modul wird als <script type="module"> geladen. Da Module deferred
 * ausgeführt werden, gate der App-Code seine Initialisierung über
 * window.neonReady (Promise), bevor er auf window.supabase zugreift.
 */

import { createClient, SupabaseAuthAdapter } from 'https://esm.sh/@neondatabase/neon-js@latest';

// Zwei-URL-Objektform (die in npm veröffentlichte Beta akzeptiert nur diese Form).
const AUTH_URL = 'https://ep-royal-dew-asrz7sl6.neonauth.c-4.eu-central-1.aws.neon.tech/neondb/auth';
const DATA_API_URL =
  'https://ep-royal-dew-asrz7sl6.apirest.c-4.eu-central-1.aws.neon.tech/neondb/rest/v1';

// Ein einziger, gemeinsam genutzter Client (Auth-State + Token-Cache).
let _client = null;

function buildClient() {
  if (_client) return _client;
  _client = createClient({
    auth: {
      url: AUTH_URL,
      adapter: SupabaseAuthAdapter(),
      // Nicht angemeldete Anfragen erhalten ein kurzlebiges anonymous-JWT.
      allowAnonymous: true,
    },
    dataApi: {
      url: DATA_API_URL,
    },
  });

  // Better Auth erlaubt beim Sign-up nur email/password/name. Die App übergibt
  // in options.data zusätzlich Profilfelder (full_name, role, ...), die Better
  // Auth mit "X is not allowed to be set" ablehnt. Diese Felder gehören ohnehin
  // nur in die separate profiles-Zeile — daher hier den Auth-Payload auf einen
  // reinen `name` reduzieren (aus full_name/name abgeleitet).
  if (_client.auth && typeof _client.auth.signUp === 'function') {
    const _origSignUp = _client.auth.signUp.bind(_client.auth);
    _client.auth.signUp = (payload = {}) => {
      const d = (payload.options && payload.options.data) || {};
      const name =
        d.name || d.full_name || d.fullName ||
        (typeof payload.email === 'string' ? payload.email.split('@')[0] : undefined);
      const clean = { ...payload, options: { ...(payload.options || {}), data: name ? { name } : {} } };
      if (name && clean.name === undefined) clean.name = name;
      return _origSignUp(clean);
    };
  }

  return _client;
}

// Supabase-kompatible Fassade: createClient(url, key) ignoriert die alten
// Argumente und liefert den Neon-Client — so bleibt die Aufrufform erhalten.
window.supabase = {
  createClient() {
    return buildClient();
  },
};

// App-Code wartet auf dieses Promise, bevor er window.supabase.createClient nutzt.
window.neonReady = Promise.resolve(true);
