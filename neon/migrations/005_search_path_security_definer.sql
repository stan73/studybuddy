-- Härtung Stufe 1 / Punkt A — 2026-09-02
-- search_path für ALLE übrigen SECURITY-DEFINER-Funktionen in `public` festnageln.
--
-- Befund (pg_proc.proconfig auf Branch production, vor der Änderung):
--   ohne search_path (NULL):        auth_child, get_configured_providers, update_child_stats
--   nur "search_path=public":       consume_ai_quota, load_child_data, sync_child_data
--   bereits "public, pg_temp" (004): load_my_data, sync_my_data
--
-- Warum auch "search_path=public" nicht reicht: Steht pg_temp nicht explizit im
-- search_path, durchsucht Postgres das temporäre Schema des Aufrufers IMPLIZIT
-- ZUERST. Ein Aufrufer könnte also z. B. eine temporäre Tabelle `children` oder
-- `api_keys` anlegen und damit die Tabellenauflösung innerhalb der
-- SECURITY-DEFINER-Funktion (läuft als neondb_owner) kapern. pg_temp explizit
-- ans ENDE setzen schließt das — dieselbe Härtung wie in 004.
--
-- Nur Konfiguration, keine Rumpf- oder ACL-Änderung. ACL-Stand zur Doku:
--   anonymous+authenticated: auth_child, get_configured_providers,
--                            load_child_data, sync_child_data, update_child_stats
--                            (Kind-Pfad per Eltern-E-Mail + PIN ohne Konto — PIN-
--                            Thema ist Punkt 1.5, hier nicht angefasst)
--   nur owner:               consume_ai_quota (wird nur aus der Netlify Function
--                            mit Owner-Verbindung aufgerufen, siehe 002)
--   nur authenticated:       load_my_data, sync_my_data (004)

ALTER FUNCTION public.auth_child(text, text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_configured_providers()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.update_child_stats(uuid, text, integer, integer, integer, integer, jsonb)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.consume_ai_quota(uuid, integer)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.load_child_data(uuid, text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_child_data(uuid, text, jsonb, jsonb, jsonb, integer, integer, integer, integer, jsonb, integer, integer, bigint)
  SET search_path = public, pg_temp;

-- Verifikation (muss 0 liefern):
-- SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.prosecdef
--    AND (p.proconfig IS NULL OR NOT ('search_path=public, pg_temp' = ANY(p.proconfig)));
-- Ergebnis auf production nach dem Lauf: 0 (alle 8 SECURITY-DEFINER-Funktionen
-- tragen "search_path=public, pg_temp"); get_configured_providers() läuft weiter.
