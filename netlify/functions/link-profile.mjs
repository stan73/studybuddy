/**
 * link-profile — verknüpft einen Neon-Auth-Account mit seiner profiles-Zeile.
 *
 * Wird nach Signup UND Login aufgerufen (idempotent). Läuft serverseitig mit
 * der Owner-Connection (bypasst RLS), weil ein migrierter Nutzer seine alte
 * profiles-Zeile (fremde alte ID) per RLS nicht selbst umhängen darf.
 *
 * Logik:
 *  1. Profil mit id = JWT.sub existiert → nichts zu tun.
 *  2. Profil mit gleicher E-Mail (aber alter ID, aus der Supabase-Migration)
 *     existiert → dessen id auf sub umhängen (FKs cascaden → Kinder/Keys/Stats
 *     bleiben verknüpft).
 *  3. sonst → frisches Profil anlegen.
 */
import { neon } from "@neondatabase/serverless";
import { createRemoteJWKSet, jwtVerify } from "jose";

const sql = neon(process.env.DATABASE_URL);
const JWKS = createRemoteJWKSet(new URL(process.env.NEON_JWKS_URL));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const sub = await verifiedSub(req);
  if (!sub) return json({ error: "Nicht autorisiert" }, 401);

  let body = {};
  try {
    body = await req.json();
  } catch {
    /* leerer Body ist ok */
  }

  try {
    // 1) Schon verknüpft?
    const byId = await sql`select id from public.profiles where id = ${sub}::uuid`;
    if (byId.length) return json({ ok: true, linked: false });

    // E-Mail/Name aus dem Neon-Auth-User ziehen (Owner darf neon_auth lesen).
    const u = await sql`select email, name from neon_auth."user" where id = ${sub}`;
    const email = u[0]?.email ?? body.email ?? null;
    const name = body.full_name || u[0]?.name || (email ? email.split("@")[0] : "Nutzer");
    if (!email) return json({ error: "Keine E-Mail für diesen Account gefunden" }, 400);

    // 2) Migriertes Profil mit gleicher E-Mail auf die neue ID umhängen.
    const byEmail = await sql`select id from public.profiles where email = ${email}`;
    if (byEmail.length) {
      await sql`update public.profiles set id = ${sub}::uuid where email = ${email}`;
      return json({ ok: true, linked: true, migrated: true });
    }

    // 3) Frisches Profil anlegen.
    await sql`
      insert into public.profiles (id, email, full_name, role, subscription)
      values (${sub}::uuid, ${email}, ${name}, 'parent', 'free')
      on conflict (id) do nothing
    `;
    return json({ ok: true, linked: true, created: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Interner Fehler" }, 500);
  }
};

async function verifiedSub(req) {
  const ah = req.headers.get("authorization");
  if (!ah) return null;
  const token = ah.replace(/^Bearer /i, "").trim();
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export const config = { path: "/.netlify/functions/link-profile" };
