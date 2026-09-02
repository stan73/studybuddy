#!/usr/bin/env node
// Syntax-Check ohne Build-Schritt:
//   - .html  → jeden <script>-Block ohne src extrahieren und mit `node --check` prüfen
//              (`node --check app.html` direkt schlägt bei HTML immer fehl)
//   - .js/.mjs → `node --check` direkt; Verzeichnisse werden rekursiv durchsucht
// Aufruf: node scripts/check-syntax.mjs app.html index.html sw.js netlify/functions scripts
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.netlify', '.gstack', 'vendor']);
const args = process.argv.slice(2);
if (!args.length) {
  console.error('Aufruf: node scripts/check-syntax.mjs <datei|verzeichnis> …');
  process.exit(2);
}

function collect(p, out) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) {
      if (SKIP_DIRS.has(e)) continue;
      collect(join(p, e), out);
    }
  } else if (['.js', '.mjs', '.cjs', '.html'].includes(extname(p))) {
    out.push(p);
  }
  return out;
}

const tmp = mkdtempSync(join(tmpdir(), 'sb-syntax-'));
let checked = 0;
let failed = 0;

function nodeCheck(file, label) {
  checked++;
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`OK    ${label}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${label}\n${String(e.stderr).trim()}`);
  }
}

for (const file of args.flatMap((a) => collect(a, []))) {
  if (extname(file) !== '.html') {
    nodeCheck(file, file);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  let i = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue; // externe Datei, wird separat geprüft
    if (/\btype\s*=\s*["'](?!module|text\/javascript|application\/javascript)/i.test(attrs))
      continue;
    i++;
    const isModule = /\btype\s*=\s*["']module["']/i.test(attrs);
    const line = html.slice(0, m.index).split('\n').length;
    const out = join(tmp, `${file.replace(/[\\/]/g, '_')}.${i}.${isModule ? 'mjs' : 'js'}`);
    writeFileSync(out, m[2]);
    nodeCheck(out, `${file} <script> #${i} (Zeile ${line}, ${m[2].length} Zeichen)`);
  }
  if (!i) console.log(`--    ${file}: kein Inline-Script`);
}

console.log(`\n${checked} geprüft, ${failed} fehlerhaft`);
process.exit(failed ? 1 : 0);
