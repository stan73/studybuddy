/**
 * Startet tests/e2e/server.mjs auf 127.0.0.1:8888 und wartet, bis
 * /__e2e/health die Kennung "studybuddy-e2e" liefert. Antwortet unter der
 * Adresse bereits ein anderer Dienst, bricht der Lauf mit klarer Meldung ab.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.E2E_PORT || 8888);
const BASE = `http://127.0.0.1:${PORT}`;
const PID_FILE = fileURLToPath(new URL('./.server.pid', import.meta.url));

async function health() {
  try {
    const res = await fetch(`${BASE}/__e2e/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.server === 'studybuddy-e2e' ? j : null;
  } catch {
    return null;
  }
}

export default async function globalSetup() {
  const hasEnv =
    process.env.E2E_DATABASE_URL &&
    process.env.E2E_NEON_AUTH_URL &&
    process.env.E2E_NEON_DATA_API_URL;
  if (!hasEnv) {
    console.log(
      '[e2e] E2E_* Variablen fehlen — Server wird nicht gestartet, Tests überspringen sich.'
    );
    return;
  }
  if (await health()) {
    console.log(`[e2e] StudyBuddy-E2E-Server läuft bereits auf ${BASE} — wird wiederverwendet.`);
    return;
  }
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
    detached: false,
  });
  writeFileSync(PID_FILE, String(child.pid));
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    if (child.exitCode !== null) throw new Error(`[e2e] Server beendet mit Code ${child.exitCode}`);
    if (await health()) {
      console.log(`[e2e] Server bereit auf ${BASE}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error(
    `[e2e] ${BASE}/__e2e/health antwortet nicht als StudyBuddy-E2E-Server — belegt ein anderer Dienst Port ${PORT}? (lsof -nP -iTCP:${PORT})`
  );
}
