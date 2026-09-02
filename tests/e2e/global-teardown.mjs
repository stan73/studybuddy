import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PID_FILE = fileURLToPath(new URL('./.server.pid', import.meta.url));

export default async function globalTeardown() {
  let pid = null;
  try {
    pid = Number(readFileSync(PID_FILE, 'utf8'));
    unlinkSync(PID_FILE);
  } catch {
    return;
  }
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* schon weg */
    }
  }
}
