// Playwright-Smoke (Härtungsplan 2.1c): App lokal auf 127.0.0.1:8888 gegen
// einen Neon-Dev-Branch. Ohne E2E_* Variablen überspringen sich die Tests
// selbst (siehe tests/e2e/smoke.spec.mjs).
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 8888);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.mjs/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'de-DE',
    // Service Worker aus: Tests sollen den Server sehen, nicht den Cache.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Eigener Server-Start (statt webServer): Port 8888 kann auf Entwickler-Rechnern
  // von einem fremden Dienst belegt sein — globalSetup prüft per /__e2e/health,
  // dass wirklich UNSER Server antwortet, statt still einen fremden zu benutzen.
  globalSetup: './tests/e2e/global-setup.mjs',
  globalTeardown: './tests/e2e/global-teardown.mjs',
});
