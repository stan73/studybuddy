-- Härtung Stufe 0 / Maßnahme 0.2 — 2026-09-02
-- Ziel: Der Browser darf gespeicherte KI-Keys nicht mehr aus api_keys lesen.
-- Die getrennten Policies api_keys_write (INSERT), api_keys_update (UPDATE)
-- und api_keys_delete (DELETE) existieren bereits; die FOR-ALL-Policy
-- "users manage own api_keys" erlaubte zusätzlich SELECT und wird entfernt.
-- Ohne SELECT-Policy greift bei RLS default-deny. Die Netlify Function
-- ai-proxy liest als neondb_owner (RLS-Bypass) und ist nicht betroffen;
-- get_configured_providers() ist SECURITY DEFINER und liefert weiterhin
-- nur die Provider-Namen.
-- Ausgeführt auf production (br-spring-brook-as21q475) via Neon MCP run_sql.

DROP POLICY IF EXISTS "users manage own api_keys" ON public.api_keys;

-- Verifikation:
-- select policyname, cmd from pg_policies where tablename = 'api_keys';
-- Erwartet: api_keys_delete/DELETE, api_keys_update/UPDATE, api_keys_write/INSERT
