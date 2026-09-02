/**
 * child-token — stellt nach PIN-Prüfung ein kurzlebiges Kind-Token aus.
 *
 * Der Kind-Login selbst läuft weiterhin über die RPC auth_child an der Data
 * API; diese Function ruft dieselbe SQL-Funktion serverseitig auf (PIN-Logik
 * unverändert) und signiert bei Erfolg { cid, exp } mit CHILD_TOKEN_SECRET.
 * ai-proxy akzeptiert den Kind-Pfad nur noch mit diesem Token.
 */
import { neon } from "@neondatabase/serverless";
import { childTokenSecret, issueChildToken } from "./_lib/child-token.mjs";
import { corsHeaders } from "./_lib/cors.mjs";

const sql = neon(process.env.DATABASE_URL);

export default async (req) => {
  const CORS = corsHeaders(req);
  const json = (status, obj) =>
    new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  const secret = childTokenSecret();
  if (!secret) {
    return json(503, {
      error: "Kind-Zugang serverseitig nicht konfiguriert (CHILD_TOKEN_SECRET fehlt) — bitte den Betreiber informieren",
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Ungültiger Request-Body (JSON erwartet)" });
  }
  const parentEmail = typeof body?.parentEmail === "string" ? body.parentEmail.trim().toLowerCase() : "";
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  if (!parentEmail || !pin || parentEmail.length > 254 || pin.length > 64) {
    return json(400, { error: "E-Mail des Elternteils und PIN erforderlich" });
  }

  try {
    const rows = await sql`select auth_child(${parentEmail}, ${pin}) as r`;
    const r = rows[0]?.r;
    if (!r || r.error || !r.child_id) return json(401, { error: r?.error || "PIN ungültig — bitte Elternteil fragen" });
    const { token, exp } = issueChildToken(secret, r.child_id);
    return json(200, { token, exp, childId: r.child_id });
  } catch {
    return json(500, { error: "Kind-Token konnte nicht ausgestellt werden — bitte später erneut versuchen" });
  }
};

export const config = { path: "/.netlify/functions/child-token" };
