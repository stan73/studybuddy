/**
 * _lib/child-token.mjs — echte Ausführung: HMAC-Roundtrip und alle
 * Ablehnungsgründe (manipulierte Signatur, manipulierter Payload, Ablauf,
 * falsches Secret, leeres/fremdes Token).
 */
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHILD_TOKEN_TTL_SECONDS,
  childTokenSecret,
  issueChildToken,
  verifyChildToken,
} from '../../netlify/functions/_lib/child-token.mjs';
import { CHILD_ID, SECRET, UUID_B } from './helpers.mjs';

const OTHER_SECRET = 'another-secret-that-is-also-long-enough-32';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

describe('childTokenSecret()', () => {
  afterEach(() => {
    delete process.env.CHILD_TOKEN_SECRET;
  });

  it('liefert null, wenn die Variable fehlt', () => {
    delete process.env.CHILD_TOKEN_SECRET;
    expect(childTokenSecret()).toBeNull();
  });

  it('liefert null bei zu kurzem Secret (< 32 Zeichen)', () => {
    process.env.CHILD_TOKEN_SECRET = 'kurz';
    expect(childTokenSecret()).toBeNull();
  });

  it('liefert das Secret ab 32 Zeichen', () => {
    process.env.CHILD_TOKEN_SECRET = SECRET;
    expect(childTokenSecret()).toBe(SECRET);
  });
});

describe('issueChildToken / verifyChildToken', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Roundtrip: ausgestelltes Token wird mit cid und exp zurückgegeben', () => {
    const { token, exp } = issueChildToken(SECRET, CHILD_ID);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const now = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThanOrEqual(now + CHILD_TOKEN_TTL_SECONDS - 2);
    expect(exp).toBeLessThanOrEqual(now + CHILD_TOKEN_TTL_SECONDS + 2);
    expect(verifyChildToken(SECRET, token)).toEqual({ cid: CHILD_ID, exp });
  });

  it('lehnt eine childId ab, die keine UUID ist', () => {
    expect(() => issueChildToken(SECRET, 'kind-1')).toThrow(/UUID/);
    expect(() => issueChildToken(SECRET, "' or 1=1 --")).toThrow(/UUID/);
  });

  it('manipulierte Signatur wird abgelehnt', () => {
    const { token } = issueChildToken(SECRET, CHILD_ID);
    const [v, payload, sig] = token.split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(() => verifyChildToken(SECRET, `${v}.${payload}.${flipped}`)).toThrow(/ungültig/);
    // Signatur mit anderer Länge (kein Timing-Leak, aber klare Ablehnung)
    expect(() => verifyChildToken(SECRET, `${v}.${payload}.${sig.slice(0, 10)}`)).toThrow(
      /ungültig/
    );
  });

  it('manipulierter Payload (fremde cid unter gültiger Signatur) wird abgelehnt', () => {
    const { token } = issueChildToken(SECRET, CHILD_ID);
    const [v, , sig] = token.split('.');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const forged = `${v}.${b64url({ cid: UUID_B, exp })}.${sig}`;
    expect(() => verifyChildToken(SECRET, forged)).toThrow(/ungültig/);
  });

  it('verlängerte Ablaufzeit unter gültiger Signatur wird abgelehnt', () => {
    const { token } = issueChildToken(SECRET, CHILD_ID);
    const [v, , sig] = token.split('.');
    const forged = `${v}.${b64url({ cid: CHILD_ID, exp: 4_102_444_800 })}.${sig}`;
    expect(() => verifyChildToken(SECRET, forged)).toThrow(/ungültig/);
  });

  it('abgelaufenes Token wird abgelehnt (echte Uhr weitergedreht)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T08:00:00Z'));
    const { token } = issueChildToken(SECRET, CHILD_ID);
    vi.setSystemTime(new Date('2026-09-02T20:00:01Z')); // TTL 12 h + 1 s
    expect(() => verifyChildToken(SECRET, token)).toThrow(/abgelaufen/);
  });

  it('Token mit ttl 0 ist sofort abgelaufen', () => {
    const { token } = issueChildToken(SECRET, CHILD_ID, 0);
    expect(() => verifyChildToken(SECRET, token)).toThrow(/abgelaufen/);
  });

  it('falsches Secret wird abgelehnt', () => {
    const { token } = issueChildToken(SECRET, CHILD_ID);
    expect(() => verifyChildToken(OTHER_SECRET, token)).toThrow(/ungültig/);
  });

  it('leeres, fehlendes, zu langes oder nicht-string Token wird abgelehnt', () => {
    expect(() => verifyChildToken(SECRET, '')).toThrow(/fehlt/);
    expect(() => verifyChildToken(SECRET, undefined)).toThrow(/fehlt/);
    expect(() => verifyChildToken(SECRET, null)).toThrow(/fehlt/);
    expect(() => verifyChildToken(SECRET, 42)).toThrow(/fehlt/);
    expect(() => verifyChildToken(SECRET, 'v1.' + 'a'.repeat(600))).toThrow(/fehlt/);
  });

  it('unbekanntes Format / falsche Version wird abgelehnt', () => {
    const { token } = issueChildToken(SECRET, CHILD_ID);
    expect(() => verifyChildToken(SECRET, token.replace(/^v1/, 'v2'))).toThrow(/Format/);
    expect(() => verifyChildToken(SECRET, 'nur-ein-teil')).toThrow(/Format/);
    expect(() => verifyChildToken(SECRET, token + '.extra')).toThrow(/Format/);
  });

  it('korrekt signierter, aber kaputter Payload wird abgelehnt', () => {
    // Signatur über einen Payload, der kein JSON bzw. keine UUID enthält

    const sign = (p) => createHmac('sha256', SECRET).update(`v1.${p}`).digest('base64url');
    const noJson = Buffer.from('nicht json').toString('base64url');
    expect(() => verifyChildToken(SECRET, `v1.${noJson}.${sign(noJson)}`)).toThrow(/beschädigt/);
    const noUuid = b64url({ cid: 'kind', exp: 4_102_444_800 });
    expect(() => verifyChildToken(SECRET, `v1.${noUuid}.${sign(noUuid)}`)).toThrow(/beschädigt/);
    const noExp = b64url({ cid: CHILD_ID });
    expect(() => verifyChildToken(SECRET, `v1.${noExp}.${sign(noExp)}`)).toThrow(/beschädigt/);
  });
});
