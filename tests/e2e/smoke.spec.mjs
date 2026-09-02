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
import {
  HAS_ENV,
  PASSWORD,
  apiSignUp,
  armOverlayHandler,
  cleanup as cleanupAccounts,
  loginViaUi,
  mail,
  openFlashcards,
  openPool,
  waitForCloudCard as waitForCloudCardIn,
} from './helpers.mjs';

const CARD_FRONT = 'Wie heißt die Hauptstadt von Frankreich?';
const CARD_BACK = 'Paris';

let pool;
test.beforeAll(() => {
  if (HAS_ENV) pool = openPool();
});
test.afterAll(async () => {
  if (!pool) return;
  const left = await cleanupAccounts(pool);
  await pool.end();
  expect(left, 'Testkonten müssen restlos gelöscht sein').toEqual({ users: 0, profiles: 0 });
});

const waitForCloudCard = (email, front) => waitForCloudCardIn(pool, email, front);

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
