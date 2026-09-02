/**
 * Playwright-Smoke (Härtungsplan 2.1c) — die App im echten Browser gegen einen
 * Neon-Dev-Branch (nie Produktion). Server: tests/e2e/server.mjs (statisch +
 * echte Netlify-Functions in-process).
 *
 * Pfad 1 (der sieben Wochen kaputt war): Registrieren → Karte anlegen →
 *   localStorage leeren → Reload → Karte kommt aus der Cloud → zweite
 *   Browser-Session (frischer Kontext, Login) sieht dieselbe Karte.
 * Pfad 2 (Punkt 1.3): #reset-password rendert das Formular statt auf / umzuleiten.
 * Pfad 3 (Punkt 1.2): serverseitig gelöschte Sitzung → App loggt aus, statt
 *   still mit dem lokalen Cache weiterzulaufen.
 *
 * Braucht E2E_DATABASE_URL, E2E_NEON_AUTH_URL, E2E_NEON_DATA_API_URL; sonst
 * überspringen sich alle Tests. Testkonten werden am Ende gelöscht (belegt).
 */
import { expect, test } from '@playwright/test';
import { Pool } from '@neondatabase/serverless';

const DB_URL = process.env.E2E_DATABASE_URL || '';
const AUTH_URL = (process.env.E2E_NEON_AUTH_URL || '').replace(/\/+$/, '');
const HAS_ENV = Boolean(DB_URL && AUTH_URL && process.env.E2E_NEON_DATA_API_URL);
const MAIL_DOMAIN = 'studybuddy-e2e.invalid';
const PASSWORD = 'E2E-Passwort-1234';
const CARD_FRONT = 'Wie heißt die Hauptstadt von Frankreich?';
const CARD_BACK = 'Paris';

const mail = (tag) =>
  `sb-e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${MAIL_DOMAIN}`;

let pool;
test.beforeAll(() => {
  if (HAS_ENV) pool = new Pool({ connectionString: DB_URL, max: 2 });
});
test.afterAll(async () => {
  if (!pool) return;
  const left = await cleanup();
  await pool.end();
  expect(left, 'Testkonten müssen restlos gelöscht sein').toEqual({ users: 0, profiles: 0 });
});

async function cleanup() {
  const like = `%@${MAIL_DOMAIN}`;
  await pool.query('delete from public.profiles where lower(email) like $1', [like]);
  await pool.query('delete from neon_auth."user" where lower(email) like $1', [like]);
  const { rows } = await pool.query(
    `select (select count(*)::int from neon_auth."user" where lower(email) like $1) as users,
            (select count(*)::int from public.profiles where lower(email) like $1) as profiles`,
    [like]
  );
  return rows[0];
}

/** Konto ohne UI anlegen (Neon Auth HTTP + echte link-profile-Function über den E2E-Server). */
async function apiSignUp(tag) {
  const email = mail(tag);
  const origin = `http://127.0.0.1:${process.env.E2E_PORT || 8888}`;
  const res = await fetch(`${AUTH_URL}/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, password: PASSWORD, name: 'E2E Exp' }),
  });
  if (res.status !== 200)
    throw new Error(`Sign-up ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const tok = await fetch(`${AUTH_URL}/token`, { headers: { cookie, origin } });
  const { token: jwt } = await tok.json();
  if (!jwt) throw new Error('kein JWT');
  const link = await fetch(`${origin}/.netlify/functions/link-profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ full_name: 'E2E Exp' }),
  });
  if (!link.ok)
    throw new Error(`link-profile ${link.status}: ${(await link.text()).slice(0, 200)}`);
  return { email, jwt };
}

/** Wartet, bis die Cloud (Owner-Sicht) die Karte des Nutzers enthält. */
async function waitForCloudCard(email, front, timeoutMs = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const { rows } = await pool.query(
      `select count(*)::int as n from cards c join profiles p on p.id = c.user_id
        where lower(p.email) = $1 and c.front = $2 and c.child_id is null`,
      [email.toLowerCase(), front]
    );
    if (rows[0].n > 0) return rows[0].n;
    if (Date.now() - t0 > timeoutMs)
      throw new Error(`Karte "${front}" ist nach ${timeoutMs} ms nicht in der Cloud`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function loginViaUi(page, email, password = PASSWORD) {
  await armOverlayHandler(page);
  await page.goto('/');
  await page.locator('button[onclick="openAuth(\'login\')"]').first().click();
  await page.fill('#l-em', email);
  await page.fill('#l-pw', password);
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForURL(/\/app\.html/, { timeout: 30_000 });
  await expect(page.locator('#content .page-header, #content h1').first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Onboarding-Dialog („Los geht's!“) erscheint zeitversetzt nach dem Laden der
 * Cloud-Daten. Ein Locator-Handler schließt ihn automatisch, sobald er eine
 * Aktion blockiert (Playwright-Mechanismus für genau solche Overlays).
 */
async function armOverlayHandler(page) {
  await page.addLocatorHandler(
    // Nur der Onboarding-Knopf (sprachunabhängig über sein onclick); das
    // versteckte Aktivitäts-Log ist ebenfalls ein role=dialog und darf nicht matchen.
    page.locator('[role=dialog] button[onclick^="this.closest(\'[role=dialog]\').remove()"]'),
    async (btn) => {
      await btn.click();
    },
    { times: 5 }
  );
}

/**
 * Karteikarten öffnen: Schüler über die Sidebar, Eltern über den Heute-Fokus-CTA
 * des Dashboards („Karten anlegen →“ = goPage('flashcards')).
 */
async function openFlashcards(page) {
  const nav = page.locator('.nav-item[data-page="flashcards"]');
  if (await nav.count()) await nav.click();
  else await page.locator('button[onclick="goPage(\'flashcards\')"]').first().click();
  await expect(page.locator('#nf')).toBeVisible();
}

test.describe('StudyBuddy Smoke (Dev-Branch)', () => {
  test.skip(!HAS_ENV, 'E2E_DATABASE_URL / E2E_NEON_AUTH_URL / E2E_NEON_DATA_API_URL fehlen');
  test.describe.configure({ mode: 'serial' });

  test('Registrieren → Karte → Reload ohne Cache → Karte da → zweite Browser-Session sieht sie', async ({
    page,
    browser,
  }) => {
    const email = mail('reg');
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    // Registrieren über das echte Formular
    await armOverlayHandler(page);
    await page.goto('/');
    await page.locator('button[onclick="openAuth(\'register\')"]').first().click();
    await page.fill('#r-fn', 'E2E');
    await page.fill('#r-ln', 'Smoke');
    await page.fill('#r-em', email);
    await page.fill('#r-pw', PASSWORD);
    await page.locator('button[onclick="doRegister()"]').click();
    await page.waitForURL(/\/app\.html/, { timeout: 45_000 });

    // Profil ist über die echte link-profile-Function entstanden
    await expect
      .poll(
        async () =>
          (
            await pool.query('select count(*)::int as n from profiles where lower(email)=$1', [
              email,
            ])
          ).rows[0].n,
        {
          timeout: 20_000,
        }
      )
      .toBe(1);

    // Karte anlegen
    await openFlashcards(page);
    await page.fill('#nf', CARD_FRONT);
    await page.fill('#nb', CARD_BACK);
    await page.locator('button[onclick="manualAddCard()"]').click();
    await expect(page.locator('#content')).toContainText(CARD_FRONT);

    // Cloud hat die Karte (Owner-Sicht) — hier scheiterte die Persistenz sieben Wochen lang still
    expect(await waitForCloudCard(email, CARD_FRONT)).toBeGreaterThanOrEqual(1);

    // Lokalen Cache wegwerfen und neu laden: Karte muss aus der Cloud kommen
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('#content .page-header, #content h1').first()).toBeVisible({
      timeout: 30_000,
    });
    await openFlashcards(page);
    await expect(page.locator('#content')).toContainText(CARD_FRONT);
    const cached = await page.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith('sb_data'))
    );
    expect(cached, 'Nach dem Reload liegt die Karte wieder im lokalen Cache').toBe(true);

    // Zweite Browser-Session: frischer Kontext, Login, gleiche Daten
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    try {
      await loginViaUi(page2, email);
      await openFlashcards(page2);
      await expect(page2.locator('#content')).toContainText(CARD_FRONT);
    } finally {
      await ctx2.close();
    }
    expect(consoleErrors, 'keine unbehandelten Fehler im Browser').toEqual([]);
  });

  test('#reset-password rendert das Formular statt auf / umzuleiten (1.3)', async ({ page }) => {
    await page.goto('/app.html?token=e2e-dummy-token#reset-password');
    await expect(page.locator('#reset-pw1')).toBeVisible();
    await expect(page.locator('#reset-pw2')).toBeVisible();
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/app.html');
    expect(page.url()).toContain('#reset-password');
  });

  test('abgelaufene Sitzung: App loggt aus und leitet zur Anmeldung (1.2)', async ({ page }) => {
    // Konto per API anlegen (UI-Registrierung deckt Test 1 ab), dann echter UI-Login
    const { email } = await apiSignUp('exp');
    await loginViaUi(page, email);
    expect(await page.evaluate(() => localStorage.getItem('sb_user'))).not.toBeNull();

    // Sitzung serverseitig beenden (wie Ablauf / Abmeldung anderswo) …
    const { rowCount } = await pool.query(
      `delete from neon_auth.session where "userId" in (select id from neon_auth."user" where lower(email) = $1)`,
      [email]
    );
    expect(rowCount).toBeGreaterThanOrEqual(1);

    // … und die Sitzungsprüfung auslösen (online-Event prüft sofort serverseitig)
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForURL(/\/(\?reason=expired)?$/, { timeout: 20_000 });
    await expect(page.locator('#l-em')).toBeVisible();
    await expect(page.locator('#toast')).toContainText(/abgelaufen/);
    expect(await page.evaluate(() => localStorage.getItem('sb_user'))).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem('sb_session'))).toBeNull();
  });
});
