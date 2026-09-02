/**
 * netlify/functions/ai-proxy.mjs — echte Ausführung des Handlers.
 * Gemockt sind nur die Außenkanten: Datenbank (fakeSql), JWKS (lokales
 * Key-Set, jwtVerify bleibt echt) und der KI-Upstream (fetch).
 *
 * Jeder Fall entspricht einem Befund aus dem Review (siehe BACKLOG.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueChildToken } from '../../netlify/functions/_lib/child-token.mjs';
import {
  CHILD_ID,
  SECRET,
  UUID_A,
  UUID_B,
  fakeSql,
  joseMockFactory,
  postJson,
  readJson,
  signJwt,
} from './helpers.mjs';

vi.mock('@neondatabase/serverless', () => ({ neon: () => fakeSql }));
vi.mock('jose', (importOriginal) => joseMockFactory(importOriginal));

const { default: handler } = await import('../../netlify/functions/ai-proxy.mjs');

const PATH = '/.netlify/functions/ai-proxy';
const MSG = [{ role: 'user', content: 'Was ist 2+2?' }];

/** Upstream-Antwort im Claude-Format */
function claudeOk(text = 'Vier.') {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Standard-DB: Parent A hat einen Claude-Key, ist im Gratis-Tarif, Quota frei. */
function dbDefaults(overrides = {}) {
  const rows = {
    api_keys: [{ api_key: 'sk-ant-parent-a' }],
    profiles: [{ subscription: 'free' }],
    quota: [{ allowed: true }],
    children: [{ parent_id: UUID_A }],
    ...overrides,
  };
  fakeSql.on((text) => {
    if (text.includes('from api_keys')) return rows.api_keys;
    if (text.includes('from profiles')) return rows.profiles;
    if (text.includes('consume_ai_quota')) return rows.quota;
    if (text.includes('from children')) return rows.children;
    throw new Error(`fakeSql: unerwartete Abfrage: ${text}`);
  });
}

let fetchMock;

beforeEach(() => {
  fakeSql.reset();
  dbDefaults();
  fetchMock = vi.fn(async () => claudeOk());
  vi.stubGlobal('fetch', fetchMock);
  delete process.env.CHILD_TOKEN_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.CHILD_TOKEN_SECRET;
});

async function call(body, headers) {
  const res = await handler(postJson(PATH, body, headers));
  return { res, json: await readJson(res) };
}

async function asParent(body, opts) {
  const jwt = await signJwt(UUID_A, opts);
  return call(body, { authorization: `Bearer ${jwt}` });
}

describe('Protokoll und Body-Validierung', () => {
  it('OPTIONS beantwortet den Preflight, GET ist 405', async () => {
    const pre = await handler(new Request(`http://localhost:8888${PATH}`, { method: 'OPTIONS' }));
    expect(pre.status).toBe(200);
    const get = await handler(new Request(`http://localhost:8888${PATH}`, { method: 'GET' }));
    expect(get.status).toBe(405);
  });

  it('kein JSON → 400', async () => {
    const { res } = await call('{nicht json');
    expect(res.status).toBe(400);
  });

  it('unbekannter Provider → 400', async () => {
    const { res, json } = await asParent({ provider: 'llama', messages: MSG });
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Provider/);
  });

  it('kaputte messages → 400 (kein Array, leer, falsche Rolle, leerer Inhalt, zu lang)', async () => {
    const cases = [
      { messages: 'hallo' },
      { messages: [] },
      { messages: [{ role: 'system', content: 'x' }] },
      { messages: [{ role: 'user', content: '' }] },
      { messages: [{ role: 'user', content: 42 }] },
      { messages: [{ role: 'user', content: 'x'.repeat(20_001) }] },
      { messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) },
      { messages: [null] },
    ];
    for (const c of cases) {
      const { res } = await asParent({ provider: 'claude', ...c });
      expect(res.status, JSON.stringify(c).slice(0, 60)).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zu großes oder ungültiges image → 400, Upstream wird nie gerufen', async () => {
    const big = { mime: 'image/png', data: 'A'.repeat(5_600_004) };
    let r = await asParent({ provider: 'claude', messages: MSG, image: big });
    expect(r.res.status).toBe(400);
    expect(r.json.error).toMatch(/zu groß/);
    r = await asParent({
      provider: 'claude',
      messages: MSG,
      image: { mime: 'image/svg+xml', data: 'AAAA' },
    });
    expect(r.res.status).toBe(400);
    r = await asParent({
      provider: 'claude',
      messages: MSG,
      image: { mime: 'image/png', data: 'nicht base64!' },
    });
    expect(r.res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('system über 8000 Zeichen → 400', async () => {
    const { res } = await asParent({ provider: 'claude', messages: MSG, system: 'x'.repeat(8001) });
    expect(res.status).toBe(400);
  });

  it('maxTok über 2000 wird auf 2000 gedeckelt, Unsinn wird zum Default 400', async () => {
    await asParent({ provider: 'claude', messages: MSG, maxTok: 999_999 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(2000);
    await asParent({ provider: 'claude', messages: MSG, maxTok: 'unendlich' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).max_tokens).toBe(400);
    await asParent({ provider: 'claude', messages: MSG, maxTok: -5 });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).max_tokens).toBe(400);
    await asParent({ provider: 'claude', messages: MSG, maxTok: 150 });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).max_tokens).toBe(150);
  });
});

describe('Identität: Neon-Auth-JWT (Eltern)', () => {
  it('fehlendes JWT → 401, kein DB-Zugriff, kein Upstream', async () => {
    const { res, json } = await call({ provider: 'claude', messages: MSG });
    expect(res.status).toBe(401);
    expect(json.error).toMatch(/Nicht autorisiert/);
    expect(fakeSql.calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('abgelaufenes JWT → 401', async () => {
    const { res } = await asParent({ provider: 'claude', messages: MSG }, { expiresIn: -60 });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('JWT mit fremdem Schlüssel signiert → 401', async () => {
    const { res } = await asParent({ provider: 'claude', messages: MSG }, { foreignKey: true });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('kaputter Bearer-Wert → 401', async () => {
    const { res } = await call(
      { provider: 'claude', messages: MSG },
      { authorization: 'Bearer abc.def' }
    );
    expect(res.status).toBe(401);
  });

  it('gültiges JWT: Key wird aus api_keys des JWT-Subjekts gelesen, Antwort durchgereicht', async () => {
    const { res, json } = await asParent({ provider: 'claude', messages: MSG });
    expect(res.status).toBe(200);
    expect(json).toEqual({ text: 'Vier.' });
    const keyQuery = fakeSql.find('from api_keys');
    expect(keyQuery).toHaveLength(1);
    expect(keyQuery[0].values).toEqual([UUID_A, 'claude']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-parent-a');
    expect(json).not.toHaveProperty('apiKey');
    expect(JSON.stringify(json)).not.toContain('sk-ant-parent-a');
  });

  it('kein Key hinterlegt → 400 mit Hinweis, kein Upstream', async () => {
    dbDefaults({ api_keys: [] });
    const { res, json } = await asParent({ provider: 'openai', messages: MSG });
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Kein openai-API-Key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Kontingent erschöpft (consume_ai_quota → false) → 429, kein Upstream', async () => {
    dbDefaults({ quota: [{ allowed: false }] });
    const { res, json } = await asParent({ provider: 'claude', messages: MSG });
    expect(res.status).toBe(429);
    expect(json.error).toMatch(/Tageslimit/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fakeSql.find('consume_ai_quota')[0].values).toEqual([UUID_A, 20]);
  });

  it('Pro-Abo umgeht das Kontingent', async () => {
    dbDefaults({ profiles: [{ subscription: 'pro' }] });
    const { res } = await asParent({ provider: 'claude', messages: MSG });
    expect(res.status).toBe(200);
    expect(fakeSql.find('consume_ai_quota')).toHaveLength(0);
  });

  it('eigener apiKey im Body (Verbindungstest): keine DB, kein Kontingent', async () => {
    const { res } = await call({ provider: 'claude', messages: MSG, apiKey: 'sk-ant-demo' });
    expect(res.status).toBe(200);
    expect(fakeSql.calls).toHaveLength(0);
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('sk-ant-demo');
  });
});

describe('Identität: Kind-Token', () => {
  it('nackte childId ohne Token → 401 (die frühere offene Lücke)', async () => {
    process.env.CHILD_TOKEN_SECRET = SECRET;
    const { res, json } = await call({ provider: 'claude', messages: MSG, childId: CHILD_ID });
    expect(res.status).toBe(401);
    expect(json.error).toMatch(/Token/);
    expect(fakeSql.calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nackte childId zusammen mit gültigem Eltern-JWT → trotzdem 401', async () => {
    process.env.CHILD_TOKEN_SECRET = SECRET;
    const { res } = await asParent({ provider: 'claude', messages: MSG, childId: CHILD_ID });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fehlendes CHILD_TOKEN_SECRET → 503, KEIN stiller Rückfall auf childId oder DB', async () => {
    delete process.env.CHILD_TOKEN_SECRET;
    const { token } = issueChildToken(SECRET, CHILD_ID);
    const { res, json } = await call({ provider: 'claude', messages: MSG, childToken: token });
    expect(res.status).toBe(503);
    expect(json.error).toMatch(/CHILD_TOKEN_SECRET/);
    expect(json).not.toHaveProperty('text');
    expect(fakeSql.calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zu kurzes CHILD_TOKEN_SECRET zählt als nicht konfiguriert → 503', async () => {
    process.env.CHILD_TOKEN_SECRET = 'kurz';
    const { token } = issueChildToken(SECRET, CHILD_ID);
    const { res } = await call({ provider: 'claude', messages: MSG, childToken: token });
    expect(res.status).toBe(503);
  });

  it('manipulierte Signatur → 401', async () => {
    process.env.CHILD_TOKEN_SECRET = SECRET;
    const { token } = issueChildToken(SECRET, CHILD_ID);
    const bad = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const { res, json } = await call({ provider: 'claude', messages: MSG, childToken: bad });
    expect(res.status).toBe(401);
    expect(json.error).toMatch(/ungültig/);
    expect(fakeSql.calls).toHaveLength(0);
  });

  it('mit falschem Secret ausgestelltes Token → 401', async () => {
    process.env.CHILD_TOKEN_SECRET = SECRET;
    const { token } = issueChildToken('some-other-secret-of-sufficient-length!', CHILD_ID);
    const { res } = await call({ provider: 'claude', messages: MSG, childToken: token });
    expect(res.status).toBe(401);
  });

  it('abgelaufenes Kind-Token → 401', async () => {
    process.env.CHILD_TOKEN_SECRET = SECRET;
    const { token } = issueChildToken(SECRET, CHILD_ID, -1);
    const { res, json } = await call({ provider: 'claude', messages: MSG, childToken: token });
    expect(res.status).toBe(401);
    expect(json.error).toMatch(/abgelaufen/);
  });

  it('gültiges Kind-Token: Key und Kontingent des Elternteils, Kind-ID aus dem Token', async () => {
    process.env.CHILD_TOKEN_SECRET = SECRET;
    const { token } = issueChildToken(SECRET, CHILD_ID);
    const { res, json } = await call({ provider: 'claude', messages: MSG, childToken: token });
    expect(res.status).toBe(200);
    expect(json.text).toBe('Vier.');
    expect(fakeSql.find('from children')[0].values).toEqual([CHILD_ID]);
    expect(fakeSql.find('from api_keys')[0].values).toEqual([UUID_A, 'claude']);
    expect(fakeSql.find('consume_ai_quota')[0].values[0]).toBe(UUID_A);
  });

  it('Kind-Token zu unbekanntem Kind → 401', async () => {
    process.env.CHILD_TOKEN_SECRET = SECRET;
    dbDefaults({ children: [] });
    const { token } = issueChildToken(SECRET, UUID_B);
    const { res } = await call({ provider: 'claude', messages: MSG, childToken: token });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Upstream', () => {
  it('Timeout nach 20 s → 504 (echter Timer über AbortController)', async () => {
    // Nur die Timer faken — Date und die Crypto-Arbeit von jwtVerify laufen echt.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    const pending = asParent({ provider: 'claude', messages: MSG });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Direkt nach dem Aufruf: noch nicht abgebrochen. (vi.waitFor dreht die
    // Fake-Uhr in kleinen Schritten weiter, deshalb kein exakter 19 999-Check.)
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    const { res, json } = await pending;
    expect(res.status).toBe(504);
    expect(json.error).toMatch(/Timeout/);
  });

  it('Upstream-Fehler wird NICHT als Erfolg maskiert (Status + Meldung durchgereicht)', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })
    );
    const { res, json } = await asParent({ provider: 'claude', messages: MSG });
    expect(res.status).toBe(401);
    expect(json).not.toHaveProperty('text');
    expect(json.error).toBe('invalid x-api-key');
  });

  it('Upstream 500 → 500, Upstream 529 → 529, Upstream 302 → 502', async () => {
    for (const [up, expected] of [
      [500, 500],
      [529, 529],
      [302, 502],
    ]) {
      fetchMock.mockImplementation(async () => new Response('{}', { status: up, statusText: 'X' }));
      const { res, json } = await asParent({ provider: 'claude', messages: MSG });
      expect(res.status, `upstream ${up}`).toBe(expected);
      expect(json).not.toHaveProperty('text');
    }
  });

  it('Netzfehler beim Upstream → 502', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const { res } = await asParent({ provider: 'claude', messages: MSG });
    expect(res.status).toBe(502);
  });

  it('Upstream 200 ohne Text → leerer text, kein Absturz', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const { res, json } = await asParent({ provider: 'claude', messages: MSG });
    expect(res.status).toBe(200);
    expect(json).toEqual({ text: '' });
  });

  it('openai: system wird vorangestellt, Bearer-Key, gedeckeltes max_tokens', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'Vier' } }] }), { status: 200 })
    );
    const { res, json } = await asParent({
      provider: 'openai',
      messages: MSG,
      system: 'Sei knapp.',
      maxTok: 5000,
    });
    expect(res.status).toBe(200);
    expect(json.text).toBe('Vier');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-ant-parent-a');
    const body = JSON.parse(init.body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Sei knapp.' });
    expect(body.max_tokens).toBe(2000);
  });

  it('gemini: Key nur in der URL (encodiert), Bild hängt an der letzten User-Nachricht', async () => {
    dbDefaults({ api_keys: [{ api_key: 'AIza key/with?chars' }] });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Vier' }] } }] }), {
        status: 200,
      })
    );
    const image = { mime: 'image/png', data: 'AAAA' };
    const { res, json } = await asParent({ provider: 'gemini', messages: MSG, image });
    expect(res.status).toBe(200);
    expect(json.text).toBe('Vier');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`key=${encodeURIComponent('AIza key/with?chars')}`);
    expect(init.headers).not.toHaveProperty('Authorization');
    const body = JSON.parse(init.body);
    expect(body.contents.at(-1).parts[1].inline_data).toEqual({
      mime_type: 'image/png',
      data: 'AAAA',
    });
    expect(body.generationConfig.maxOutputTokens).toBe(400);
  });
});
