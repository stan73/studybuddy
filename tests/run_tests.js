#!/usr/bin/env node
/**
 * StudyBuddy Pro — Automatisierter Testrunner
 * ============================================
 * Führt statische Analyse der app.html durch.
 * Ausführen: node tests/run_tests.js
 *
 * Kategorien:
 *   T1  Syntax
 *   T2  Routing & Navigation
 *   T3  Kritische Funktionen vorhanden
 *   T4  Exam-Logik
 *   T5  Karteikarten-Logik
 *   T6  KI-Tutor-Logik
 *   T7  Auth & Logout
 *   T8  API-Key-Validierung
 *   T9  Aktivitäts-Log
 *   T10 HTML-Struktur & Barrierefreiheit
 *   T11 Daten-Konsistenz (localStorage-Keys)
 *   T12 Sicherheit (XSS-Guards)
 */

const fs   = require('fs');
const path = require('path');

// ── Datei laden ────────────────────────────────────────────────────────────
const APP = path.resolve(__dirname, '../app.html');
if (!fs.existsSync(APP)) { console.error('❌ app.html nicht gefunden:', APP); process.exit(1); }
const html = fs.readFileSync(APP, 'utf8');
const scriptMatch = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('❌ Kein <script>-Block gefunden'); process.exit(1); }
const js = scriptMatch[1];

// ── Test-Engine ────────────────────────────────────────────────────────────
let passed = 0, failed = 0, warned = 0;
const results = [];

function test(id, desc, fn) {
  try {
    const result = fn();
    if (result === true) {
      passed++;
      results.push({ status: 'PASS', id, desc });
      console.log(`  ✅ ${id} ${desc}`);
    } else if (result && result.warn) {
      warned++;
      results.push({ status: 'WARN', id, desc, detail: result.warn });
      console.log(`  ⚠️  ${id} ${desc} — ${result.warn}`);
    } else {
      failed++;
      const detail = typeof result === 'string' ? result : JSON.stringify(result);
      results.push({ status: 'FAIL', id, desc, detail });
      console.log(`  ❌ ${id} ${desc}${detail ? ' — ' + detail : ''}`);
    }
  } catch(e) {
    failed++;
    results.push({ status: 'FAIL', id, desc, detail: e.message });
    console.log(`  ❌ ${id} ${desc} — EXCEPTION: ${e.message}`);
  }
}

function has(str) { return js.includes(str); }
function hasHtml(str) { return html.includes(str); }
function count(regex) { return (js.match(regex) || []).length; }
function fnDefined(name) { return new RegExp(`(?:function\\s+${name}|${name}\\s*=\\s*(?:async\\s+)?function|const\\s+${name}\\s*=)`).test(js); }
function fnCalled(name) { return new RegExp(`${name}\\s*\\(`).test(js); }

// ══════════════════════════════════════════════════════════════════════════
// T1 — SYNTAX
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT1 — Syntax');
test('T1.1', 'JavaScript-Syntax fehlerfrei', () => {
  try { new Function(js); return true; }
  catch(e) { return e.message; }
});
test('T1.2', 'Keine offenen Template-Literals (`)', () => {
  const backticks = (js.match(/`/g) || []).length;
  return backticks % 2 === 0 ? true : `Ungerade Anzahl Backticks: ${backticks}`;
});
test('T1.3', 'Keine offenen geschwungenen Klammern', () => {
  const open  = (js.match(/\{/g) || []).length;
  const close = (js.match(/\}/g) || []).length;
  return open === close ? true : `{: ${open}, }: ${close}`;
});
test('T1.4', 'HTML-Grundstruktur vorhanden', () => {
  return html.includes('<!DOCTYPE html>') && html.includes('<html') && html.includes('</html>');
});
test('T1.5', 'Kein eval() im Code', () => {
  return !/(^|[^a-z])eval\s*\(/.test(js) ? true : 'eval() gefunden — Sicherheitsrisiko';
});

// ══════════════════════════════════════════════════════════════════════════
// T2 — ROUTING & NAVIGATION
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT2 — Routing & Navigation');
const PAGES = ['dashboard','subjects','flashcards','tutor','exam','planner','pomodoro','parent','children','teacher','subscription','settings'];
PAGES.forEach(p => {
  test(`T2.${PAGES.indexOf(p)+1}`, `Page '${p}' im Router registriert`, () => {
    return js.includes(`'${p}'`) || js.includes(`"${p}"`);
  });
});
test('T2.13', 'goPage() definiert', () => fnDefined('goPage'));
test('T2.14', 'Router hat async-Error-Handling (Promise.catch)', () => has('ret instanceof Promise'));
test('T2.15', 'Router hat sync-Error-Handling (try-catch)', () => has('_routerError'));

// ══════════════════════════════════════════════════════════════════════════
// T3 — KRITISCHE FUNKTIONEN
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT3 — Kritische Funktionen');
const REQUIRED_FNS = [
  'init','doLogout','renderSidebar','updateXP','save','load','toast','appLog',
  'openLog','closeLog','filterLog','clearLog','_updateLogBadge','_renderLogEntries',
  'safe','safeHTML','ai','hasActiveKey','activeKey','saveAIKeys','loadAIKeys',
  'loadConfiguredProviders','saveProviderKey','testKeyConnection','settings',
  'saveProfile','resetData','dashboard','subjects','flashcards','renderFC',
  'rateCard','manualAddCard','genCards','tutor','sendMsg','exam','startExam',
  'renderExam','answerQ','endExam','planner','addTask','deleteTask','completeTask',
  'renderTaskList','pomodoro','renderPomo','togglePomo','resetPomo',
  'parentDash','childrenPage','addChildWithPin','updatePin','removeChild',
  'teacherDash','subscription','populateDemoData',
];
REQUIRED_FNS.forEach((fn, i) => {
  test(`T3.${i+1}`, `${fn}() definiert`, () => fnDefined(fn) || has(`function ${fn}`));
});

// ══════════════════════════════════════════════════════════════════════════
// T4 — EXAM-LOGIK
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT4 — Prüfungsmodus (Exam)');
test('T4.1', 'EX-State mit answered-Flag initialisiert', () => has('answered:false'));
test('T4.2', 'FALLBACK_QS vorhanden', () => fnDefined('FALLBACK_QS') || has('const FALLBACK_QS'));
test('T4.3', 'FALLBACK_QS enthält Mathematik', () => has("'Mathematik'"));
test('T4.4', 'FALLBACK_QS enthält default-Fallback', () => has("'default'"));
test('T4.5', 'startExam: FALLBACK_QS wird genutzt', () => {
  const fn = js.match(/async function startExam\(\)([\s\S]*?)(?=\n(?:function|async function|\/{2,}|\/\*))/)?.[0] || '';
  return fn.includes('FALLBACK_QS') ? true : 'FALLBACK_QS nicht in startExam gefunden';
});
test('T4.6', 'startExam: q.correct zu Number normalisiert', () => {
  const fn = js.match(/async function startExam\(\)([\s\S]*?)(?=\n(?:function|async function|\/{2,}|\/\*))/)?.[0] || '';
  return fn.includes('parseInt(q.correct') ? true : 'parseInt-Normalisierung fehlt';
});
test('T4.7', 'startExam: try-catch um renderExam', () => {
  const fn = js.match(/async function startExam\(\)([\s\S]*?)(?=\nfunction renderExam)/)?.[0] || '';
  return fn.includes('try {') && fn.includes('renderExam') ? true : 'try-catch fehlt';
});
test('T4.8', 'answerQ: Doppelklick-Guard (EX.answered)', () => {
  const fn = js.match(/function answerQ\(i\)([\s\S]*?)(?=\nfunction endExam)/)?.[0] || '';
  return fn.includes('EX.answered') ? true : 'EX.answered Guard fehlt';
});
test('T4.9', 'answerQ: EX.answered wird in setTimeout zurückgesetzt', () => {
  const fn = js.match(/function answerQ\(i\)([\s\S]*?)(?=\nfunction endExam)/)?.[0] || '';
  return fn.includes('EX.answered = false') ? true : 'Reset in setTimeout fehlt';
});
test('T4.10', 'endExam: "Nochmal"-Button nutzt goPage', () => {
  const fn = js.match(/function endExam\(el\)([\s\S]*?)(?=\n\/\/|$)/)?.[0] || '';
  return fn.includes("goPage('exam')") ? true : 'goPage-Aufruf fehlt';
});
test('T4.11', 'renderExam: Fortschrittsbalken vorhanden', () => has('progress-bar'));
test('T4.12', 'Alle 9 Fachbereiche in FALLBACK_QS', () => {
  const subjects = ["'Mathematik'","'Deutsch'","'Englisch'","'Biologie'","'Chemie'","'Physik'","'Geschichte'","'Geografie'","'Informatik'","'default'"];
  const missing = subjects.filter(s => !js.includes(s));
  return missing.length === 0 ? true : `Fehlend: ${missing.join(', ')}`;
});

// ══════════════════════════════════════════════════════════════════════════
// T5 — KARTEIKARTEN
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT5 — Karteikarten');
test('T5.1', 'FC-State definiert', () => has('let FC ='));
test('T5.2', 'Spaced-Repetition SR_DAYS konfiguriert', () => has('SR_DAYS'));
test('T5.3', 'rateCard: Level-Anpassung (SM-2)', () => {
  const fn = js.match(/function rateCard[\s\S]*?(?=\nfunction manualAddCard)/)?.[0] || '';
  return fn.includes('newLevel') && fn.includes('daysUntilNext') ? true : 'SR-Logik fehlt';
});
test('T5.4', 'manualAddCard: Validierung beider Felder', () => {
  const fn = js.match(/function manualAddCard[\s\S]*?(?=\n\/\*\*|async function genCards)/)?.[0] || '';
  return fn.includes('!front || !back') ? true : 'Validierung fehlt';
});
test('T5.5', 'genCards: hasActiveKey-Prüfung', () => {
  const fn = js.match(/async function genCards[\s\S]*?(?=\n\/\/|\/\*\*)/)?.[0] || '';
  return fn.includes('hasActiveKey') ? true : 'API-Key-Check fehlt';
});
test('T5.6', 'genCards: JSON-Parse mit Fehlerbehandlung', () => {
  const fn = js.match(/async function genCards[\s\S]*?(?=\n\/\/|\/\*\*)/)?.[0] || '';
  return fn.includes('catch') ? true : 'Fehlerbehandlung fehlt';
});
test('T5.7', 'XP für Karteikarten konfiguriert (CFG.XP.CARD)', () => has('CFG.XP.CARD'));

// ══════════════════════════════════════════════════════════════════════════
// T6 — KI-TUTOR
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT6 — KI-Tutor');
test('T6.1', 'sendMsg: hasActiveKey-Prüfung', () => {
  const fn = js.match(/async function sendMsg[\s\S]*?(?=\n\/\/|\/\*\*)/)?.[0] || '';
  return fn.includes('hasActiveKey') ? true : 'API-Key-Check fehlt';
});
test('T6.2', 'sendMsg: "Tutor tippt…"-Indikator', () => has('Tutor tippt'));
test('T6.3', 'sendMsg: Typing-Indikator wird entfernt bei Fehler', () => {
  const fn = js.match(/async function sendMsg[\s\S]*?(?=\n\/\/|\/\*\*)/)?.[0] || '';
  return fn.includes("getElementById('typing')?.remove()") ? true : 'Cleanup fehlt';
});
test('T6.4', 'sendMsg: Max-6-Nachrichten-Kontext', () => has('slice(-6)'));
test('T6.5', 'XP für Tutor vergeben (CFG.XP.TUTOR)', () => has('CFG.XP.TUTOR'));

// ══════════════════════════════════════════════════════════════════════════
// T7 — AUTH & SESSION
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT7 — Auth & Session');
test('T7.1', 'doLogout: Supabase-Abmeldung', () => has('sb.auth.signOut'));
test('T7.2', 'doLogout: AI-State wird zurückgesetzt', () => {
  const fn = js.match(/async function doLogout[\s\S]*?(?=\n\/\/|\/\*\*|\nfunction)/)?.[0] || '';
  return fn.includes('AI =') && fn.includes("provider:'claude'") ? true : 'AI-Reset fehlt';
});
test('T7.3', 'doLogout: localStorage.clear()', () => {
  const fn = js.match(/async function doLogout[\s\S]*?(?=\n\/\/|\/\*\*|\nfunction)/)?.[0] || '';
  return fn.includes('localStorage.clear()') ? true : 'localStorage-Clear fehlt';
});
test('T7.4', 'doLogout: Redirect zur Startseite', () => has("window.location.href = '/'"));
test('T7.5', 'init: await loadConfiguredProviders', () => has('await loadConfiguredProviders'));
test('T7.6', 'Demo-Modus vorhanden', () => has('isDemo'));
test('T7.7', 'Kind-Login (PIN) vorhanden', () => has('sb_child_session'));
test('T7.8', 'hasActiveKey prüft RAM + DB (_hasDbKey)', () => {
  // Funktion ist einzeilig — direkt im JS suchen
  const line = js.split('\n').find(l => l.includes('function hasActiveKey'));
  return line && line.includes('_hasDbKey') && line.includes('activeKey()') ? true : 'Unvollständige Prüfung';
});

// ══════════════════════════════════════════════════════════════════════════
// T8 — API-KEY-VALIDIERUNG
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT8 — API-Key-Validierung');
test('T8.1', 'saveProviderKey: Präfix-Prüfung', () => {
  const fn = js.match(/async function saveProviderKey[\s\S]*?(?=\nasync function testKeyConnection)/)?.[0] || '';
  return fn.includes('keyPrefix') ? true : 'Präfix-Prüfung fehlt';
});
test('T8.2', 'saveProviderKey: Schutz vor Anbieter-Verwechslung (sk-ant- bei openai)', () => {
  const fn = js.match(/async function saveProviderKey[\s\S]*?(?=\nasync function testKeyConnection)/)?.[0] || '';
  return fn.includes('sk-ant-') ? true : 'Verwechslungsschutz fehlt';
});
test('T8.3', 'saveProviderKey: Verbindungstest VOR dem Speichern', () => {
  const fn = js.match(/async function saveProviderKey[\s\S]*?(?=\nasync function testKeyConnection)/)?.[0] || '';
  const testIdx = fn.indexOf('testKeyConnection');
  const saveIdx = fn.indexOf('saveAIKeys');
  return testIdx !== -1 && saveIdx !== -1 && testIdx < saveIdx ? true : 'Reihenfolge falsch: Test muss VOR Speichern';
});
test('T8.4', 'saveProviderKey: Key wird NICHT gespeichert wenn Test fehlschlägt', () => {
  const fn = js.match(/async function saveProviderKey[\s\S]*?(?=\nasync function testKeyConnection)/)?.[0] || '';
  return fn.includes('return; // Key NICHT') || (fn.includes('testOk') && fn.includes('return;')) ? true : 'Abbruch bei Testfehler fehlt';
});
test('T8.5', 'testKeyConnection: nutzt Supabase-Proxy (kein CORS-Problem)', () => {
  const fn = js.match(/async function testKeyConnection[\s\S]*?(?=\nfunction resetData)/)?.[0] || '';
  return fn.includes('CFG.AI_PROXY') ? true : 'Proxy-Aufruf fehlt';
});
test('T8.6', 'testKeyConnection: sendet apiKey im Body (kein DB-Lookup)', () => {
  const fn = js.match(/async function testKeyConnection[\s\S]*?(?=\nfunction resetData)/)?.[0] || '';
  return fn.includes("apiKey:   key") || fn.includes("apiKey: key") ? true : 'apiKey-Body-Parameter fehlt';
});
test('T8.7', 'testKeyConnection: sendet Authorization Bearer (User-JWT oder Anon-JWT)', () => {
  const fn = js.match(/async function testKeyConnection[\s\S]*?(?=\nfunction resetData)/)?.[0] || '';
  return fn.includes("'Authorization'") && fn.includes('SB_KEY') ? true : 'Bearer-Token-Logik fehlt';
});
test('T8.8', '"Aktiv"-Badge nur nach erfolgreichem Test gesetzt', () => {
  const fn = js.match(/async function saveProviderKey[\s\S]*?(?=\nasync function testKeyConnection)/)?.[0] || '';
  return fn.includes('testOk') && fn.includes('_hasDbKey') ? true : 'Badge-Kontrolle fehlt';
});

// ══════════════════════════════════════════════════════════════════════════
// T9 — AKTIVITÄTS-LOG
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT9 — Aktivitäts-Log');
test('T9.1', 'LOG_KEY konstant definiert', () => has("const LOG_KEY = 'sb_applog'"));
test('T9.2', 'LOG_MAX = 100', () => has('const LOG_MAX = 100'));
test('T9.3', 'Ringpuffer: 101. Eintrag verdrängt ältesten', () => {
  const fn = js.match(/function appLog[\s\S]*?(?=\nfunction _readLog)/)?.[0] || '';
  return fn.includes('entries.length = LOG_MAX') || fn.includes('LOG_MAX') ? true : 'Ringpuffer-Logik fehlt';
});
test('T9.4', 'toast() ruft appLog() auf', () => {
  const fn = js.match(/function toast\(msg[\s\S]*?(?=\n\/\/|\/\*\*|\nwindow)/)?.[0] || '';
  return fn.includes('appLog(msg)') ? true : 'appLog-Hook fehlt';
});
test('T9.5', 'Typen-Erkennung: success/error/warning/info', () => {
  return has("'success'") && has("'error'") && has("'warning'") && has("'info'");
});
test('T9.6', 'openLog() und closeLog() definiert', () => fnDefined('openLog') && fnDefined('closeLog'));
test('T9.7', 'filterLog() definiert', () => fnDefined('filterLog'));
test('T9.8', 'clearLog() mit Bestätigung', () => {
  const fn = js.match(/function clearLog[\s\S]*?(?=\n\/\/|\/\*\*|\nfunction)/)?.[0] || '';
  return fn.includes('confirm') ? true : 'Bestätigung fehlt';
});
test('T9.9', 'Log-Drawer HTML vorhanden', () => hasHtml('log-drawer'));
test('T9.10', 'Log-Button im Header vorhanden', () => hasHtml('log-btn'));
test('T9.11', 'ESC-Handler registriert', () => has('_logEscHandler'));
test('T9.12', 'Badge zeigt ungesehene Fehler an', () => has('log-badge'));

// ══════════════════════════════════════════════════════════════════════════
// T10 — HTML-STRUKTUR & BARRIEREFREIHEIT
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT10 — HTML-Struktur & Barrierefreiheit');
test('T10.1', 'Viewport-Meta-Tag vorhanden', () => hasHtml('viewport'));
test('T10.2', 'lang-Attribut gesetzt (de)', () => hasHtml('lang="de"'));
test('T10.3', 'meta description vorhanden', () => hasHtml('<meta name="description"'));
test('T10.4', 'PWA-Manifest verlinkt', () => hasHtml('manifest.json'));
test('T10.5', 'Service Worker registriert', () => has('serviceWorker.register'));
test('T10.6', 'aria-label auf Navigation', () => hasHtml('role="menubar"'));
test('T10.7', 'aria-live auf Content-Bereich', () => hasHtml('aria-live="polite"'));
test('T10.8', 'Toast hat role="alert"', () => hasHtml('role="alert"'));
test('T10.9', '#content als Rendering-Ziel vorhanden', () => hasHtml('id="content"'));
test('T10.10', 'Sidebar-Overlay vorhanden (Mobile)', () => hasHtml('sidebar-overlay'));

// ══════════════════════════════════════════════════════════════════════════
// T11 — DATENKONSISTENZ
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT11 — Datenkonsistenz & localStorage');
const LS_KEYS = ['sb_data_', 'sb_aikeys_', 'sb_applog', 'sb_child_session', 'sb_session', 'sb_demo_login'];
LS_KEYS.forEach((k, i) => {
  test(`T11.${i+1}`, `localStorage-Key '${k}' konsistent genutzt`, () => {
    const uses = (js.match(new RegExp(k.replace('_','\\_'), 'g')) || []).length;
    return uses >= 1 ? true : { warn: `Key '${k}' nur ${uses}x verwendet` };
  });
});
test('T11.7', 'D-Objekt-Initialstruktur vollständig', () => {
  return js.includes('cards:{}') && js.includes('tasks:[]') && js.includes('exams:[]') && js.includes('xp:0');
});
test('T11.8', 'save() und load() definiert', () => fnDefined('save') && fnDefined('load'));
test('T11.9', 'XP-Konfiguration: CARD, EXAM, TUTOR, POMO', () => {
  return has('XP.CARD') && has('XP.EXAM') && has('XP.TUTOR') && has('XP.POMO');
});

// ══════════════════════════════════════════════════════════════════════════
// T12 — SICHERHEIT
// ══════════════════════════════════════════════════════════════════════════
console.log('\nT12 — Sicherheit & XSS-Schutz');
test('T12.1', 'safe() Funktion: &, <, >, " escaped', () => {
  const fn = js.match(/function safe\([\s\S]*?(?=\nfunction |\n\/\*\*)/)?.[0] || '';
  return fn.includes('&amp;') && fn.includes('&lt;') && fn.includes('&gt;') ? true : 'Escaping unvollständig';
});
test('T12.2', 'safeHTML() Funktion mit Whitelist', () => fnDefined('safeHTML'));
test('T12.3', 'KI-Antworten via safeHTML() ausgegeben', () => has('safeHTML(answer'));
test('T12.4', 'Nutzereingaben via safe() ausgegeben', () => {
  const safeCount = (js.match(/safe\(/g) || []).length;
  return safeCount >= 10 ? true : { warn: `Nur ${safeCount} safe()-Aufrufe — ggf. fehlend` };
});
test('T12.5', 'API-Keys nicht in console.log', () => {
  const logMatches = js.match(/console\.log\([^)]*(?:key|Key|apiKey|AI\[)[^)]*\)/g) || [];
  return logMatches.length === 0 ? true : `Mögliche Key-Ausgabe: ${logMatches[0]}`;
});
test('T12.6', 'Supabase-Service-Role-Key nicht im Frontend', () => {
  return !js.includes('service_role') ? true : '⚠️ service_role Key im Frontend gefunden!';
});

// ══════════════════════════════════════════════════════════════════════════
// ERGEBNIS-ZUSAMMENFASSUNG
// ══════════════════════════════════════════════════════════════════════════
const total = passed + failed + warned;
console.log('\n' + '═'.repeat(60));
console.log(`ERGEBNIS: ${passed}/${total} bestanden  |  ${failed} fehlgeschlagen  |  ${warned} Warnungen`);
console.log('═'.repeat(60));

if (failed > 0) {
  console.log('\nFEHLER (müssen behoben werden):');
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`  ❌ ${r.id} ${r.desc}${r.detail ? '\n     → ' + r.detail : ''}`);
  });
}
if (warned > 0) {
  console.log('\nWARNUNGEN (prüfen empfohlen):');
  results.filter(r => r.status === 'WARN').forEach(r => {
    console.log(`  ⚠️  ${r.id} ${r.desc}: ${r.detail}`);
  });
}

// JSON-Report speichern
const report = {
  timestamp: new Date().toISOString(),
  file: 'app.html',
  summary: { total, passed, failed, warned },
  results,
};
fs.writeFileSync(path.resolve(__dirname, 'last_report.json'), JSON.stringify(report, null, 2));
console.log('\n📄 Report gespeichert: tests/last_report.json');

process.exit(failed > 0 ? 1 : 0);
