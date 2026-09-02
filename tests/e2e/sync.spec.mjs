/**
 * Härtung 1.1 im echten Browser — die beiden Datenverlust-Szenarien aus dem
 * Härtungsplan, gegen einen Neon-Dev-Branch mit Migration 006.
 *
 * Szenario B (offline): Schreibvorgänge zur Cloud schlagen fehl (Route auf
 *   rpc/sync_my_data abgebrochen — wie ohne Netz), Karte wird angelegt →
 *   Zustand „ausstehend“ → Neustart der App: die (leere) Cloud darf den lokalen
 *   Stand NICHT überschreiben → Verbindung zurück + online-Event → Karte liegt
 *   in der Cloud, Zustand „synchron“.
 * Szenario A (zwei Geräte): zwei Browser-Kontexte desselben Kontos. Laptop legt
 *   drei Karten an; das Tablet arbeitet noch mit der alten Datenversion und legt
 *   eine Karte an → der Server lehnt ab, der Client führt zusammen → alle vier
 *   Karten sind in der Cloud und auf beiden Geräten.
 *
 * Braucht E2E_DATABASE_URL, E2E_NEON_AUTH_URL, E2E_NEON_DATA_API_URL; sonst
 * überspringen sich die Tests. Testkonten werden am Ende gelöscht (belegt).
 */
import { expect, test } from '@playwright/test';
import {
  HAS_ENV,
  addCard,
  apiSignUp,
  cleanup,
  cloudCards,
  localFronts,
  loginViaUi,
  openFlashcards,
  openPool,
  waitForCloudCard,
} from './helpers.mjs';

let pool;
test.beforeAll(() => {
  if (HAS_ENV) pool = openPool();
});
test.afterAll(async () => {
  if (!pool) return;
  const left = await cleanup(pool);
  await pool.end();
  expect(left, 'Testkonten müssen restlos gelöscht sein').toEqual({ users: 0, profiles: 0 });
});

const status = (page) => page.locator('#sync-status');

test.describe('Härtung 1.1: Sync mit Konflikterkennung (Dev-Branch)', () => {
  test.skip(!HAS_ENV, 'E2E_DATABASE_URL / E2E_NEON_AUTH_URL / E2E_NEON_DATA_API_URL fehlen');
  test.describe.configure({ mode: 'serial' });

  test('SZENARIO B: Offline-Änderung überlebt den Neustart und landet nach dem online-Event in der Cloud', async ({
    page,
  }) => {
    const { email } = await apiSignUp('offl');
    const FRONT = 'Offline gelernt: Was ist 6 · 7?';
    await loginViaUi(page, email);
    await expect(status(page)).toHaveAttribute('data-state', 'synced', { timeout: 15_000 });

    // Cloud-Schreibvorgänge schlagen fehl (wie ohne Netz) …
    await page.route('**/rpc/sync_my_data', (route) => route.abort('internetdisconnected'));
    await openFlashcards(page);
    await addCard(page, FRONT, '42');
    await expect(status(page)).toHaveAttribute('data-state', /pending|offline|failed/, {
      timeout: 15_000,
    });
    await page.waitForTimeout(1500);
    expect(await cloudCards(pool, email, FRONT), 'nichts in der Cloud').toBe(0);

    // … Neustart: die (leere) Cloud darf den lokalen Stand nicht überschreiben
    await page.reload();
    await expect(page.locator('#content .page-header, #content h1').first()).toBeVisible({
      timeout: 30_000,
    });
    await openFlashcards(page);
    await expect(page.locator('#content')).toContainText(FRONT);
    await expect(status(page)).toHaveAttribute('data-state', /pending|offline|failed/, {
      timeout: 15_000,
    });
    expect(await cloudCards(pool, email, FRONT)).toBe(0);
    const stored = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('sb_sync_'));
      return k ? JSON.parse(localStorage.getItem(k)) : null;
    });
    expect(stored?.pending, 'Warteschlange ist persistiert').toBe(true);

    // Verbindung zurück → online-Event → Warteschlange wird gesendet
    await page.unroute('**/rpc/sync_my_data');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    expect(await waitForCloudCard(pool, email, FRONT)).toBe(1);
    await expect(status(page)).toHaveAttribute('data-state', 'synced', { timeout: 15_000 });
    expect(await cloudCards(pool, email)).toBe(1);
  });

  test('SZENARIO A: zwei Geräte — drei Karten vom Laptop und eine Bewertung/Karte vom Tablet bleiben alle erhalten', async ({
    browser,
  }) => {
    const { email } = await apiSignUp('twod');
    const laptop = await (await browser.newContext()).newPage();
    const tablet = await (await browser.newContext()).newPage();
    const errors = [];
    laptop.on('pageerror', (e) => errors.push('laptop: ' + e));
    tablet.on('pageerror', (e) => errors.push('tablet: ' + e));
    try {
      await loginViaUi(laptop, email);
      await loginViaUi(tablet, email); // beide Geräte kennen Datenversion 0

      // Laptop: drei Karten
      await openFlashcards(laptop);
      for (const f of ['Laptop-Karte 1', 'Laptop-Karte 2', 'Laptop-Karte 3']) {
        await addCard(laptop, f, 'Antwort');
      }
      await waitForCloudCard(pool, email, 'Laptop-Karte 3');
      expect(await cloudCards(pool, email)).toBe(3);

      // Tablet (alter Stand): eine Karte — vor 1.1 hätte dieser Blob die drei Laptop-Karten gelöscht
      await openFlashcards(tablet);
      await addCard(tablet, 'Tablet-Karte', 'Antwort');
      await waitForCloudCard(pool, email, 'Tablet-Karte');
      await expect(status(tablet)).toHaveAttribute('data-state', 'synced', { timeout: 15_000 });
      expect(await cloudCards(pool, email), 'alle vier Karten in der Cloud').toBe(4);

      // Tablet hat die Laptop-Karten übernommen (Merge), Laptop bekommt die Tablet-Karte beim nächsten Laden
      const tabletCards = await localFronts(tablet);
      expect(tabletCards).toEqual([
        'Laptop-Karte 1',
        'Laptop-Karte 2',
        'Laptop-Karte 3',
        'Tablet-Karte',
      ]);
      await laptop.reload();
      await expect(laptop.locator('#content .page-header, #content h1').first()).toBeVisible({
        timeout: 30_000,
      });
      expect(await localFronts(laptop)).toEqual([
        'Laptop-Karte 1',
        'Laptop-Karte 2',
        'Laptop-Karte 3',
        'Tablet-Karte',
      ]);
      await expect(status(laptop)).toHaveAttribute('data-state', 'synced', { timeout: 15_000 });
      expect(await cloudCards(pool, email)).toBe(4);
    } finally {
      await laptop.context().close();
      await tablet.context().close();
    }
    expect(errors, 'keine unbehandelten Fehler im Browser').toEqual([]);
  });
});
