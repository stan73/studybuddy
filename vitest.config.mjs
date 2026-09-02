// Vitest — führt die Netlify Functions (tests/unit) und die SQL-/RLS-Tests
// (tests/db) wirklich aus. Die alte Textsuche-Suite bleibt unter
// tests/run_tests.js (npm test ruft beide). Playwright liegt in tests/e2e und
// wird hier bewusst ausgeschlossen.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.mjs', 'tests/db/**/*.test.mjs'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    // Die Functions lesen diese Variablen beim Import — Platzhalter reichen,
    // weil Datenbank und JWKS in den Unit-Tests gemockt werden.
    env: {
      DATABASE_URL: 'postgres://unit-test@localhost/unit-test',
      NEON_JWKS_URL: 'https://jwks.invalid/.well-known/jwks.json',
    },
    // DB-/API-Tests teilen sich einen Dev-Branch — Dateien nacheinander, nicht parallel.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
});
