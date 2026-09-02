/**
 * Gemeinsame Test-Helfer für die Function-Tests.
 *
 * - fakeSql:          Ersatz für neon(DATABASE_URL) — zeichnet jede Abfrage auf
 *                     und liefert, was der Test per fakeSql.on(...) vorgibt.
 * - joseMockFactory:  ersetzt createRemoteJWKSet (Netz) durch ein lokales
 *                     Key-Set; jwtVerify selbst bleibt die echte jose-Prüfung
 *                     (Signatur, Ablauf, kid).
 * - signJwt:          stellt Neon-Auth-ähnliche JWTs mit dem Test-Schlüssel
 *                     aus — oder mit einem fremden Schlüssel.
 */

function createFakeSql() {
  const calls = [];
  let handler = () => [];
  const sql = async (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join('$') : String(strings);
    const norm = text.replace(/\s+/g, ' ').trim();
    calls.push({ text: norm, values });
    return handler(norm, values);
  };
  sql.calls = calls;
  sql.on = (fn) => {
    handler = fn;
  };
  sql.reset = () => {
    calls.length = 0;
    handler = () => [];
  };
  sql.find = (needle) => calls.filter((c) => c.text.includes(needle));
  return sql;
}

export const fakeSql = createFakeSql();

// Wird von joseMockFactory befüllt (Schlüsselpaar + echte jose-Exporte).
export const testKeys = {};
export const TEST_KID = 'sb-unit-test-key';

export async function joseMockFactory(importOriginal) {
  const actual = await importOriginal();
  const { publicKey, privateKey } = await actual.generateKeyPair('RS256');
  const jwk = await actual.exportJWK(publicKey);
  Object.assign(jwk, { kid: TEST_KID, alg: 'RS256', use: 'sig' });
  const other = await actual.generateKeyPair('RS256');
  Object.assign(testKeys, { actual, privateKey, otherPrivateKey: other.privateKey });
  return {
    ...actual,
    // Kein Netz: das "entfernte" JWKS ist das lokale Test-Key-Set.
    createRemoteJWKSet: () => actual.createLocalJWKSet({ keys: [jwk] }),
  };
}

/**
 * JWT wie von Neon Auth: sub = User-ID. Optionen:
 *   expiresIn  — z. B. '10m' oder eine negative Zahl (Sekunden) für "abgelaufen"
 *   foreignKey — mit fremdem Schlüssel signieren (Signatur muss abgelehnt werden)
 */
export async function signJwt(sub, { expiresIn = '10m', foreignKey = false } = {}) {
  const { actual, privateKey, otherPrivateKey } = testKeys;
  const now = Math.floor(Date.now() / 1000);
  const jwt = new actual.SignJWT({ sub })
    .setProtectedHeader({ alg: 'RS256', kid: TEST_KID })
    .setIssuedAt(now)
    .setIssuer('https://neon-auth.test')
    .setAudience('studybuddy-test');
  if (typeof expiresIn === 'number') jwt.setExpirationTime(now + expiresIn);
  else jwt.setExpirationTime(expiresIn);
  return jwt.sign(foreignKey ? otherPrivateKey : privateKey);
}

export const ORIGIN = 'https://gleaming-gaufre-b15c11.netlify.app';

export function postJson(path, body, headers = {}) {
  return new Request(`http://localhost:8888${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text };
  }
}

export const UUID_A = '11111111-1111-4111-8111-111111111111';
export const UUID_B = '22222222-2222-4222-8222-222222222222';
export const CHILD_ID = '33333333-3333-4333-8333-333333333333';
export const SECRET = 'unit-test-child-token-secret-with-32+chars';
