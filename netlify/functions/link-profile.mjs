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
import { corsHeaders } from "./_lib/cors.mjs";

const sql = neon(process.env.DATABASE_URL);
const JWKS = createRemoteJWKSet(new URL(process.env.NEON_JWKS_URL));
const MAX_NAME_CHARS = 120;

export default async (req) => {
  const CORS = corsHeaders(req);
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

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

    // E-Mail ausschließlich aus dem Neon-Auth-User (Owner darf neon_auth lesen).
    // Ein clientseitig mitgeschickter Wert zählt nie — sonst könnte jeder
    // Angemeldete ein fremdes Profil auf seine Auth-ID umhängen.
    const u = await sql`select email, name, "emailVerified" as verified from neon_auth."user" where id = ${sub}::uuid`;
    const email = typeof u[0]?.email === "string" ? u[0].email.trim().toLowerCase() : null;
    if (!email) return json({ error: "Keine E-Mail für diesen Account gefunden" }, 400);
    const clientName = typeof body.full_name === "string" ? body.full_name.trim().slice(0, MAX_NAME_CHARS) : "";
    const name = clientName || u[0]?.name || email.split("@")[0];

    // 2) Migriertes Profil mit gleicher E-Mail auf die neue ID umhängen —
    //    nur, wenn die E-Mail des Auth-Kontos verifiziert ist.
    const byEmail = await sql`select id from public.profiles where lower(email) = ${email}`;
    if (byEmail.length) {
      if (u[0]?.verified !== true) {
        return json(
          {
            error:
              "Zu dieser E-Mail existiert bereits ein StudyBuddy-Konto. Bitte bestätige zuerst deine E-Mail-Adresse — danach werden deine bisherigen Daten automatisch mit dem neuen Login verknüpft.",
            code: "email_unverified",
          },
          403,
        );
      }
      await sql`update public.profiles set id = ${sub}::uuid where lower(email) = ${email}`;
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

export const config = { path: "/.netlify/functions/link-profile" };
