-- Härtung Stufe 0 / Maßnahme 0.1 — 2026-09-02 (Datenkorrektur, kein Schema)
-- Bestandsschutz: link-profile hängt bestehende Profile nur noch bei
-- verifizierter E-Mail um. Das bestehende echte Eigentümer-Konto wurde
-- daher VOR dem Umschalten als verifiziert markiert.
-- Angefasste ID: a1f4f9a7-8130-47e4-b114-dd7b37f46e8c (stanqiqi@gmail.com)
-- Nicht angefasst: dbe5d574-16dd-49d8-8f4e-e900bd565715 (Smoke-Test, example.com)

update neon_auth."user"
   set "emailVerified" = true, "updatedAt" = now()
 where id = 'a1f4f9a7-8130-47e4-b114-dd7b37f46e8c'
   and email = 'stanqiqi@gmail.com';

-- Vorlage für migrierte Familienkonten nach deren Neuregistrierung
-- (Identität ist dem Betreiber bekannt; bis eine OTP-Eingabe im Client existiert):
-- update neon_auth."user" set "emailVerified" = true, "updatedAt" = now()
--  where lower(email) in ('fatmir@sinani.de', 'valdete@sinani.de');
