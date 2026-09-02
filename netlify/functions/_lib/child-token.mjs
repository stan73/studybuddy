/**
 * Kind-Token — kurzlebiges, HMAC-SHA256-signiertes Token für den Kind-Pfad
 * des KI-Proxys. Ausgestellt von child-token.mjs nach erfolgreicher
 * PIN-Prüfung (auth_child), verifiziert in ai-proxy.mjs.
 *
 * Format:  v1.<base64url(payload)>.<base64url(hmac)>
 * Payload: { cid: <children.id>, exp: <Unix-Sekunden> }
 * Schlüssel: process.env.CHILD_TOKEN_SECRET — nur in der Netlify-Umgebung,
 * nie im Repo. Fehlt er, verweigern beide Functions den Kind-Pfad.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const CHILD_TOKEN_TTL_SECONDS = 12 * 60 * 60; // eine Lernsitzung

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Secret aus der Umgebung; null, wenn nicht gesetzt oder zu kurz (< 32 Zeichen). */
export function childTokenSecret() {
  const s = process.env.CHILD_TOKEN_SECRET;
  return typeof s === "string" && s.length >= 32 ? s : null;
}

function hmac(secret, data) {
  return createHmac("sha256", secret).update(data).digest();
}

export function issueChildToken(secret, childId, ttl = CHILD_TOKEN_TTL_SECONDS) {
  if (!UUID_RE.test(String(childId))) throw new Error("childId ist keine UUID");
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload = Buffer.from(JSON.stringify({ cid: childId, exp })).toString("base64url");
  const sig = hmac(secret, `v1.${payload}`).toString("base64url");
  return { token: `v1.${payload}.${sig}`, exp };
}

/** Liefert { cid, exp } oder wirft einen Error mit nutzerverständlicher Meldung. */
export function verifyChildToken(secret, token) {
  if (typeof token !== "string" || token.length === 0 || token.length > 512) {
    throw new Error("Kind-Token fehlt — bitte neu einloggen");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Kind-Token hat ein unbekanntes Format — bitte neu einloggen");
  const expected = hmac(secret, `v1.${parts[1]}`);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error("Kind-Token ungültig — bitte neu einloggen");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Kind-Token beschädigt — bitte neu einloggen");
  }
  if (!payload || typeof payload.cid !== "string" || !UUID_RE.test(payload.cid) || !Number.isFinite(payload.exp)) {
    throw new Error("Kind-Token beschädigt — bitte neu einloggen");
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) throw new Error("Kind-Sitzung abgelaufen — bitte neu einloggen");
  return { cid: payload.cid, exp: payload.exp };
}
