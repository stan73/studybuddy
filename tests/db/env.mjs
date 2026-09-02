/**
 * Umgebung für die SQL-/RLS-Tests. Sie laufen NUR gegen einen Neon-Dev-Branch
 * (niemals Produktion) und überspringen sich selbst, wenn die Variablen fehlen:
 *
 *   TEST_DATABASE_URL   Owner-Verbindung des Dev-Branches (neondb_owner; direkter
 *                       Host ohne "-pooler", damit SET LOCAL ROLE in Transaktionen
 *                       sauber greift)
 *   TEST_NEON_AUTH_URL  Neon-Auth-Basis-URL des Branches (…/neondb/auth)
 *   TEST_DATA_API_URL   Neon-Data-API des Branches (…/neondb/rest/v1)
 *   TEST_AUTH_ORIGIN    Origin, den Neon Auth als vertrauenswürdig kennt
 *                       (Default: Produktionsdomain)
 */
export const DB_URL = process.env.TEST_DATABASE_URL || '';
export const AUTH_URL = (process.env.TEST_NEON_AUTH_URL || '').replace(/\/+$/, '');
export const API_URL = (process.env.TEST_DATA_API_URL || '').replace(/\/+$/, '');
export const AUTH_ORIGIN =
  process.env.TEST_AUTH_ORIGIN || 'https://gleaming-gaufre-b15c11.netlify.app';

export const hasDb = Boolean(DB_URL);
export const hasApi = hasDb && Boolean(AUTH_URL) && Boolean(API_URL);

if (/prod|spring-brook|ep-royal-dew/i.test(DB_URL + AUTH_URL + API_URL)) {
  throw new Error(
    'tests/db: Produktions-Endpunkt erkannt — die Tests laufen nur gegen Dev-Branches.'
  );
}

export const skipReason = hasDb
  ? hasApi
    ? ''
    : 'TEST_NEON_AUTH_URL/TEST_DATA_API_URL fehlen'
  : 'TEST_DATABASE_URL fehlt';
