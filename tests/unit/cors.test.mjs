/**
 * _lib/cors.mjs — fremder Origin bekommt keinen Access-Control-Allow-Origin,
 * eigener schon; Env-Erweiterungen (Netlify-Preview, ALLOWED_ORIGINS) greifen.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allowedOrigins, corsHeaders } from '../../netlify/functions/_lib/cors.mjs';
import { ORIGIN } from './helpers.mjs';

const ENV_KEYS = ['URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL', 'ALLOWED_ORIGINS'];
const saved = {};

function reqWithOrigin(origin) {
  const headers = origin == null ? {} : { origin };
  return new Request('http://localhost:8888/.netlify/functions/x', { method: 'POST', headers });
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('corsHeaders()', () => {
  it('eigener Produktions-Origin bekommt Allow-Origin', () => {
    const h = corsHeaders(reqWithOrigin(ORIGIN));
    expect(h['Access-Control-Allow-Origin']).toBe(ORIGIN);
    expect(h.Vary).toBe('Origin');
    expect(h['Access-Control-Allow-Methods']).toContain('POST');
  });

  it('fremder Origin bekommt KEINEN Allow-Origin (auch kein Wildcard)', () => {
    for (const evil of [
      'https://evil.example',
      'https://gleaming-gaufre-b15c11.netlify.app.evil.example',
      'http://gleaming-gaufre-b15c11.netlify.app', // http statt https
      'null',
    ]) {
      const h = corsHeaders(reqWithOrigin(evil));
      expect(h, evil).not.toHaveProperty('Access-Control-Allow-Origin');
      expect(Object.values(h)).not.toContain('*');
    }
  });

  it('ohne Origin-Header kein Allow-Origin', () => {
    expect(corsHeaders(reqWithOrigin(null))).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('localhost:8888 (netlify dev) ist erlaubt, andere Ports nicht', () => {
    expect(corsHeaders(reqWithOrigin('http://localhost:8888'))['Access-Control-Allow-Origin']).toBe(
      'http://localhost:8888'
    );
    expect(corsHeaders(reqWithOrigin('http://localhost:3000'))).not.toHaveProperty(
      'Access-Control-Allow-Origin'
    );
  });
});

describe('allowedOrigins() — Erweiterung per Umgebung', () => {
  it('Netlify-Preview-URLs (URL/DEPLOY_PRIME_URL/DEPLOY_URL) werden ohne Slash übernommen', () => {
    process.env.DEPLOY_PRIME_URL = 'https://deploy-preview-42--gleaming-gaufre-b15c11.netlify.app/';
    process.env.DEPLOY_URL = 'https://abc123--gleaming-gaufre-b15c11.netlify.app';
    const set = allowedOrigins();
    expect(set.has('https://deploy-preview-42--gleaming-gaufre-b15c11.netlify.app')).toBe(true);
    expect(set.has('https://abc123--gleaming-gaufre-b15c11.netlify.app')).toBe(true);
    expect(
      corsHeaders(reqWithOrigin('https://deploy-preview-42--gleaming-gaufre-b15c11.netlify.app'))[
        'Access-Control-Allow-Origin'
      ]
    ).toBe('https://deploy-preview-42--gleaming-gaufre-b15c11.netlify.app');
  });

  it('ALLOWED_ORIGINS (kommasepariert, Leerzeichen/Slash tolerant) wird ergänzt', () => {
    process.env.ALLOWED_ORIGINS = ' https://a.example/ , https://b.example ,, ';
    const set = allowedOrigins();
    expect(set.has('https://a.example')).toBe(true);
    expect(set.has('https://b.example')).toBe(true);
    expect(set.has('')).toBe(false);
    expect(corsHeaders(reqWithOrigin('https://c.example'))).not.toHaveProperty(
      'Access-Control-Allow-Origin'
    );
  });
});
