/**
 * Gemeinsame Helfer der Playwright-Tests (smoke.spec.mjs, sync.spec.mjs):
 * Testkonten per Neon Auth + echter link-profile-Function, UI-Login, Karten
 * anlegen, Cloud-Sicht über die Owner-Verbindung, Aufräumen.
 */
import { expect } from '@playwright/test';
import { Pool } from '@neondatabase/serverless';

export const DB_URL = process.env.E2E_DATABASE_URL || '';
export const AUTH_URL = (process.env.E2E_NEON_AUTH_URL || '').replace(/\/+$/, '');
export const HAS_ENV = Boolean(DB_URL && AUTH_URL && process.env.E2E_NEON_DATA_API_URL);
export const MAIL_DOMAIN = 'studybuddy-e2e.invalid';
export const PASSWORD = 'E2E-Passwort-1234';
export const ORIGIN = `http://127.0.0.1:${process.env.E2E_PORT || 8888}`;

export const mail = (tag) =>
  `sb-e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${MAIL_DOMAIN}`;

export function openPool() {
  return new Pool({ connectionString: DB_URL, max: 2 });
}

/** Löscht alle E2E-Testkonten (Auth, Profile, Kaskaden, verwaiste sync_state) und liefert Restzählung. */
export async function cleanup(pool) {
  const like = `%@${MAIL_DOMAIN}`;
  await pool.query('delete from public.profiles where lower(email) like $1', [like]);
  await pool.query('delete from neon_auth."user" where lower(email) like $1', [like]);
  await pool.query(
    `delete from public.sync_state s
      where not exists (select 1 from public.profiles p where p.id = s.scope_id)
        and not exists (select 1 from public.children c where c.id = s.scope_id)`
  );
  const { rows } = await pool.query(
    `select (select count(*)::int from neon_auth."user" where lower(email) like $1) as users,
            (select count(*)::int from public.profiles where lower(email) like $1) as profiles`,
    [like]
  );
  return rows[0];
}

/** Konto ohne UI anlegen (Neon Auth HTTP + echte link-profile-Function über den E2E-Server). */
export async function apiSignUp(tag) {
  const email = mail(tag);
  const res = await fetch(`${AUTH_URL}/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password: PASSWORD, name: 'E2E Exp' }),
  });
  if (res.status !== 200)
    throw new Error(`Sign-up ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const tok = await fetch(`${AUTH_URL}/token`, { headers: { cookie, origin: ORIGIN } });
  const { token: jwt } = await tok.json();
  if (!jwt) throw new Error('kein JWT');
  const link = await fetch(`${ORIGIN}/.netlify/functions/link-profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ full_name: 'E2E Exp' }),
  });
  if (!link.ok)
    throw new Error(`link-profile ${link.status}: ${(await link.text()).slice(0, 200)}`);
  return { email, jwt };
}

/** Anzahl Karten des Nutzers in der Cloud (Owner-Sicht); front optional. */
export async function cloudCards(pool, email, front) {
  const { rows } = await pool.query(
    `select count(*)::int as n from cards c join profiles p on p.id = c.user_id
      where lower(p.email) = $1 and c.child_id is null and ($2::text is null or c.front = $2)`,
    [email.toLowerCase(), front ?? null]
  );
  return rows[0].n;
}

/** Wartet, bis die Cloud (Owner-Sicht) die Karte des Nutzers enthält. */
export async function waitForCloudCard(pool, email, front, timeoutMs = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const n = await cloudCards(pool, email, front);
    if (n > 0) return n;
    if (Date.now() - t0 > timeoutMs)
      throw new Error(`Karte "${front}" ist nach ${timeoutMs} ms nicht in der Cloud`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Onboarding-Dialog („Los geht's!“) erscheint zeitversetzt nach dem Laden der
 * Cloud-Daten. Ein Locator-Handler schließt ihn automatisch, sobald er eine
 * Aktion blockiert (Playwright-Mechanismus für genau solche Overlays).
 */
export async function armOverlayHandler(page) {
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

export async function loginViaUi(page, email, password = PASSWORD) {
  await armOverlayHandler(page);
  await page.goto('/');
  await page.locator('button[onclick="openAuth(\'login\')"]').first().click();
  // Das Login-Modal setzt den Fokus zeitversetzt auf das E-Mail-Feld; tippt Playwright
  // genau dann ins Passwortfeld, landet der Text im E-Mail-Feld. Daher: ausfüllen,
  // prüfen, notfalls wiederholen.
  const em = page.locator('#l-em');
  const pw = page.locator('#l-pw');
  await expect(pw).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await em.fill(email);
    await pw.fill(password);
    if ((await em.inputValue()) === email && (await pw.inputValue()) === password) break;
    await page.waitForTimeout(300);
  }
  await expect(em).toHaveValue(email);
  await expect(pw).toHaveValue(password);
  // Neon Auth begrenzt /sign-in/email pro Zeitfenster („Too many requests“) — mehrere
  // UI-Logins kurz hintereinander (zwei Geräte) brauchen ggf. eine Wartepause + Wiederholung.
  const seen = [];
  const poll = setInterval(async () => {
    const txt = await page
      .locator('#toast')
      .textContent()
      .catch(() => '');
    if (txt && !seen.includes(txt)) seen.push(txt);
  }, 200);
  try {
    for (let attempt = 1; ; attempt++) {
      await page.locator('button[onclick="doLogin()"]').click();
      try {
        await page.waitForURL(/\/app\.html/, { timeout: 15_000 });
        break;
      } catch (e) {
        if (attempt >= 3) {
          const diag = await page
            .evaluate(() => ({
              neonReady: typeof window.neonReady,
              supabase: typeof window.supabase,
              em: document.getElementById('l-em')?.value,
              pwLen: (document.getElementById('l-pw')?.value || '').length,
              btn: document.querySelector('#auth-body .btn-primary')?.textContent,
            }))
            .catch(() => null);
          throw new Error(
            `UI-Login blieb auf der Startseite. Toasts: ${JSON.stringify(seen)} · Zustand: ${JSON.stringify(diag)} · ${e.message.split('\n')[0]}`
          );
        }
        await page.waitForTimeout(11_000);
      }
    }
  } finally {
    clearInterval(poll);
  }
  await expect(page.locator('#content .page-header, #content h1').first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Karteikarten öffnen: Schüler über die Sidebar, Eltern über den Heute-Fokus-CTA
 * des Dashboards („Karten anlegen →“ = goPage('flashcards')).
 */
export async function openFlashcards(page) {
  const nav = page.locator('.nav-item[data-page="flashcards"]');
  if (await nav.count()) await nav.click();
  else await page.locator('button[onclick="goPage(\'flashcards\')"]').first().click();
  await expect(page.locator('#nf')).toBeVisible();
}

/**
 * Karte über das echte Formular anlegen. Die Seite zeigt nur die aktuelle Karte,
 * deshalb gilt als Erfolg, dass manualAddCard() die Eingabefelder leert.
 */
export async function addCard(page, front, back) {
  await page.fill('#nf', front);
  await page.fill('#nb', back);
  await page.locator('button[onclick="manualAddCard()"]').click();
  await expect(page.locator('#nf')).toHaveValue('');
  await expect(page.locator('#content')).toContainText(/gesamt|total|au total|en total/);
}

/** Vorderseiten aller Karten aus dem lokalen Stand (sb_data_<uid>) der Seite, sortiert. */
export async function localFronts(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb_data_'));
    if (!key) return [];
    const d = JSON.parse(localStorage.getItem(key));
    return Object.values(d.cards || {})
      .flat()
      .map((c) => c.front)
      .sort();
  });
}
