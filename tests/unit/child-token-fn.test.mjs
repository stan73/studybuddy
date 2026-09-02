/**
 * netlify/functions/child-token.mjs — echte Ausführung: PIN-Prüfung läuft über
 * die (gemockte) SQL-Funktion auth_child; das ausgestellte Token muss von
 * verifyChildToken akzeptiert werden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyChildToken } from '../../netlify/functions/_lib/child-token.mjs';
import { CHILD_ID, SECRET, fakeSql, postJson, readJson } from './helpers.mjs';

vi.mock('@neondatabase/serverless', () => ({ neon: () => fakeSql }));

const { default: handler } = await import('../../netlify/functions/child-token.mjs');
const PATH = '/.netlify/functions/child-token';

beforeEach(() => {
  fakeSql.reset();
  process.env.CHILD_TOKEN_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.CHILD_TOKEN_SECRET;
});

async function call(body) {
  const res = await handler(postJson(PATH, body));
  return { res, json: await readJson(res) };
}

describe('child-token', () => {
  it('ohne CHILD_TOKEN_SECRET → 503, auth_child wird nicht gerufen', async () => {
    delete process.env.CHILD_TOKEN_SECRET;
    const { res, json } = await call({ parentEmail: 'p@example.com', pin: '1234' });
    expect(res.status).toBe(503);
    expect(json.error).toMatch(/CHILD_TOKEN_SECRET/);
    expect(fakeSql.calls).toHaveLength(0);
  });

  it('fehlende/zu lange Eingaben → 400', async () => {
    expect((await call({})).res.status).toBe(400);
    expect((await call({ parentEmail: 'p@example.com' })).res.status).toBe(400);
    expect((await call({ parentEmail: 'p@example.com', pin: 1234 })).res.status).toBe(400);
    expect((await call({ parentEmail: 'p@example.com', pin: 'x'.repeat(65) })).res.status).toBe(
      400
    );
    expect((await call('kein json')).res.status).toBe(400);
    expect(fakeSql.calls).toHaveLength(0);
  });

  it('auth_child meldet Fehler (falsche PIN) → 401, kein Token', async () => {
    fakeSql.on(() => [{ r: { error: 'PIN ungültig' } }]);
    const { res, json } = await call({ parentEmail: 'P@Example.com ', pin: ' 0000 ' });
    expect(res.status).toBe(401);
    expect(json).not.toHaveProperty('token');
    expect(fakeSql.calls[0].values).toEqual(['p@example.com', '0000']);
  });

  it('auth_child ohne child_id → 401', async () => {
    fakeSql.on(() => [{ r: null }]);
    expect((await call({ parentEmail: 'p@example.com', pin: '1234' })).res.status).toBe(401);
  });

  it('DB-Fehler → 500', async () => {
    fakeSql.on(() => {
      throw new Error('boom');
    });
    expect((await call({ parentEmail: 'p@example.com', pin: '1234' })).res.status).toBe(500);
  });

  it('richtige PIN → Token, das verifyChildToken auf genau dieses Kind auflöst', async () => {
    fakeSql.on(() => [{ r: { child_id: CHILD_ID, name: 'Kind' } }]);
    const { res, json } = await call({ parentEmail: 'p@example.com', pin: '1234' });
    expect(res.status).toBe(200);
    expect(json.childId).toBe(CHILD_ID);
    const v = verifyChildToken(SECRET, json.token);
    expect(v.cid).toBe(CHILD_ID);
    expect(v.exp).toBe(json.exp);
    expect(() =>
      verifyChildToken('wrong-secret-that-is-long-enough-32chars', json.token)
    ).toThrow();
  });
});
