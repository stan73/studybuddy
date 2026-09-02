#!/usr/bin/env node
// Versionsgleichstand: package.json ist die einzige Quelle der Wahrheit.
// Bump: `npm version <x.y.z> --no-git-tag-version`, dann die hier geprüften Stellen nachziehen.
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version; // x.y.z
const short = version.split('.').slice(0, 2).join('.'); // x.y (Sidebar-Badge)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const checks = [
  [
    'app.html',
    `Sidebar-Badge v${short}`,
    (t) => new RegExp(`id="sb-version">v${esc(short)}<`).test(t),
  ],
  ['app.html', `@version ${version}`, (t) => new RegExp(`@version ${esc(version)}\\b`).test(t)],
  ['sw.js', `@version ${version}`, (t) => new RegExp(`@version ${esc(version)}\\b`).test(t)],
  [
    'docs/SBOM.json',
    `metadata.component.version ${version}`,
    (t) => JSON.parse(t).metadata.component.version === version,
  ],
  [
    'docs/SECURITY.md',
    `Versionsverlauf-Zeile | ${version} |`,
    (t) => new RegExp(`^\\| ${esc(version)} \\|`, 'm').test(t),
  ],
];

let failed = 0;
for (const [file, label, test] of checks) {
  const ok = test(readFileSync(file, 'utf8'));
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${file}: ${label}`);
}
console.log(
  failed
    ? `\n${failed} Stelle(n) weichen von package.json (${version}) ab.`
    : `\nAlle Stellen auf ${version}.`
);
process.exit(failed ? 1 : 0);
