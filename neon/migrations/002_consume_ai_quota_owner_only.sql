-- Härtung Stufe 0 / Maßnahme 0.3 — 2026-09-02
-- consume_ai_quota() war trotz supabase/migrations/010 noch für PUBLIC,
-- anonymous und authenticated ausführbar → jeder Client hätte fremde Quota
-- verbrauchen können. Nur der DB-Owner (Netlify Functions) darf sie aufrufen.
-- Ausgeführt auf production (br-spring-brook-as21q475) via Neon MCP.

REVOKE EXECUTE ON FUNCTION public.consume_ai_quota(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_ai_quota(uuid, integer) FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.consume_ai_quota(uuid, integer) FROM authenticated;

-- Verifikation (erwartet: acl = {neondb_owner=X/neondb_owner}, beide false):
-- select proacl, has_function_privilege('anonymous', oid, 'EXECUTE'),
--        has_function_privilege('authenticated', oid, 'EXECUTE')
--   from pg_proc where proname = 'consume_ai_quota';
