/**
 * ai-proxy — StudyBuddy KI-Proxy (Netlify Function, Neon-Backend)
 * Sicherer Proxy für KI-Anfragen. Gespeicherte API-Keys werden nur hier
 * serverseitig aufgelöst; der Client kann sie nicht aus der DB lesen.
 *
 * Zugangspfade:
 *  - Elternteil: Neon-Auth-JWT (Bearer) → Key aus api_keys des Nutzers
 *  - Kind:       HMAC-signiertes Kind-Token (child-token.mjs) → Key des Elternteils
 *  - Eigener Key im Body (Verbindungstest / Demo) → keine DB, kein Quota
 * Serverseitige Grenzen (max_tokens, Nachrichten, Bildgröße, Upstream-Timeout)
 * gelten unabhängig davon, was der Client schickt.
 */
import { neon } from "@neondatabase/serverless";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { childTokenSecret, verifyChildToken } from "./_lib/child-token.mjs";
import { corsHeaders } from "./_lib/cors.mjs";

const sql = neon(process.env.DATABASE_URL);
const JWKS = createRemoteJWKSet(new URL(process.env.NEON_JWKS_URL));
const FREE_DAILY_LIMIT = 20;

const MODELS = {
  claude: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
};

// ── Harte Grenzen ────────────────────────────────────────────────────────────
const MAX_TOKENS_DEFAULT = 400;
const MAX_TOKENS_HARD_CAP = 2000;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 20000;
const MAX_TOTAL_CHARS = 60000;
const MAX_SYSTEM_CHARS = 8000;
const MAX_API_KEY_CHARS = 512;
// Base64-Zeichen ≈ 4,2 MB Rohdaten; Netlify-Request-Limit liegt bei 6 MB Body
const MAX_IMAGE_B64_CHARS = 5_600_000;
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);
const UPSTREAM_TIMEOUT_MS = 20000;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export default async (req) => {
  const CORS = corsHeaders(req);
  const err = (status, message) =>
    new Response(JSON.stringify({ error: message }), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return err(405, "Method Not Allowed");

  let body;
  try {
    body = await req.json();
  } catch {
    return err(400, "Ungültiger Request-Body (JSON erwartet)");
  }
  if (!body || typeof body !== "object") return err(400, "Ungültiger Request-Body");

  const { provider, messages, system, apiKey: passedKey, childToken, image } = body;

  // ── Eingaben validieren ────────────────────────────────────────────────────
  if (typeof provider !== "string" || !MODELS[provider]) return err(400, `Unbekannter Provider: ${String(provider)}`);
  const msgErr = validateMessages(messages);
  if (msgErr) return err(400, msgErr);
  if (system != null && (typeof system !== "string" || system.length > MAX_SYSTEM_CHARS)) {
    return err(400, `system muss ein String bis ${MAX_SYSTEM_CHARS} Zeichen sein`);
  }
  const maxTok = clampMaxTok(body.maxTok);
  if (image != null) {
    const imgErr = validateImage(image);
    if (imgErr) return err(400, imgErr);
  }
  if (passedKey != null && (typeof passedKey !== "string" || passedKey.length > MAX_API_KEY_CHARS)) {
    return err(400, "apiKey ungültig");
  }
  if (body.childId && !childToken) {
    // Alte Client-Variante (childId ohne Token) wird nicht mehr akzeptiert.
    return err(401, "Kind-Sitzung ohne gültiges Token — bitte neu einloggen");
  }

  try {
    let apiKey = passedKey || null;
    let ownerId = null;
    let childId = null;

    // ── Identität: Kind-Token oder Neon-Auth-JWT ───────────────────────────
    if (childToken) {
      const secret = childTokenSecret();
      if (!secret) {
        return err(503, "Kind-Zugang serverseitig nicht konfiguriert (CHILD_TOKEN_SECRET fehlt) — bitte den Betreiber informieren");
      }
      try {
        childId = verifyChildToken(secret, childToken).cid;
      } catch (e) {
        return err(401, e instanceof Error ? e.message : "Kind-Token ungültig");
      }
      const rows = await sql`select parent_id from children where id = ${childId}::uuid`;
      ownerId = rows[0]?.parent_id ?? null;
      if (!ownerId) return err(401, "Kind-Profil nicht gefunden — bitte neu einloggen");
    } else {
      ownerId = await verifiedSub(req);
    }

    // ── API-Key serverseitig auflösen ──────────────────────────────────────
    if (!apiKey) {
      if (!ownerId) return err(401, "Nicht autorisiert — bitte einloggen");
      const rows = await sql`select api_key from api_keys where user_id = ${ownerId}::uuid and provider = ${provider}`;
      apiKey = rows[0]?.api_key ?? null;
    }
    if (!apiKey) {
      return err(
        400,
        childId
          ? `Kein ${provider}-API-Key hinterlegt — der Elternteil muss ihn in den Einstellungen eintragen`
          : `Kein ${provider}-API-Key hinterlegt — bitte in den Einstellungen eintragen`,
      );
    }

    // ── Free-Tier-Limit ────────────────────────────────────────────────────
    if (ownerId) {
      const prof = await sql`select subscription from profiles where id = ${ownerId}::uuid`;
      if ((prof[0]?.subscription ?? "free") === "free") {
        const q = await sql`select consume_ai_quota(${ownerId}::uuid, ${FREE_DAILY_LIMIT}) as allowed`;
        if (q[0]?.allowed === false) {
          return err(429, `Tageslimit erreicht (${FREE_DAILY_LIMIT} KI-Anfragen/Tag im Gratis-Tarif). Upgrade für unbegrenzte Anfragen.`);
        }
      }
    }

    // ── Upstream-Aufruf (mit Timeout) ──────────────────────────────────────
    let r;
    let d;
    try {
      if (provider === "claude") {
        const claudeMsgs = image ? withLastUserContent(messages, (m) => [
          { type: "text", text: m.content },
          image.mime === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: image.data } }
            : { type: "image", source: { type: "base64", media_type: image.mime, data: image.data } },
        ]) : messages;
        r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: MODELS.claude, max_tokens: maxTok, system: system || undefined, messages: claudeMsgs }),
        });
        d = await r.json().catch(() => ({}));
        if (!r.ok) return err(upstreamStatus(r.status), d?.error?.message ?? r.statusText);
        return ok(CORS, d.content?.[0]?.text ?? "");
      }

      if (provider === "openai") {
        const oaiMsgs = image ? withLastUserContent(messages, (m) => [
          { type: "text", text: m.content },
          { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } },
        ]) : messages;
        const msgs = system ? [{ role: "system", content: system }, ...oaiMsgs] : oaiMsgs;
        r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: MODELS.openai, max_tokens: maxTok, messages: msgs }),
        });
        d = await r.json().catch(() => ({}));
        if (!r.ok) return err(upstreamStatus(r.status), d?.error?.message ?? r.statusText);
        return ok(CORS, d.choices?.[0]?.message?.content ?? "");
      }

      // gemini
      const contents = messages.map((m, i) => {
        const parts = [{ text: m.content }];
        if (image && i === messages.length - 1 && m.role === "user") {
          parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
        }
        return { role: m.role === "assistant" ? "model" : "user", parts };
      });
      if (system) contents.unshift({ role: "user", parts: [{ text: system }] });
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent?key=${encodeURIComponent(apiKey)}`;
      r = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTok } }),
      });
      d = await r.json().catch(() => ({}));
      if (!r.ok) return err(upstreamStatus(r.status), d?.error?.message ?? r.statusText);
      return ok(CORS, d.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    } catch (e) {
      if (e?.name === "AbortError" || e?.name === "TimeoutError") {
        return err(504, `Der KI-Anbieter hat nicht rechtzeitig geantwortet (Timeout nach ${UPSTREAM_TIMEOUT_MS / 1000} s) — bitte erneut versuchen`);
      }
      return err(502, "KI-Anbieter nicht erreichbar — bitte später erneut versuchen");
    }
  } catch {
    return err(500, "Interner Serverfehler");
  }
};

// ── Helfer ───────────────────────────────────────────────────────────────────

function ok(CORS, text) {
  return new Response(JSON.stringify({ text }), { headers: { ...CORS, "Content-Type": "application/json" } });
}

/** Ersetzt den content der letzten User-Nachricht durch ein Content-Array (Vision/PDF). */
function withLastUserContent(messages, build) {
  return messages.map((m, i) => (i === messages.length - 1 && m.role === "user" ? { role: "user", content: build(m) } : m));
}

/** Liefert einen Fehlertext oder null, wenn messages gültig ist. */
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "messages muss ein nicht-leeres Array sein";
  if (messages.length > MAX_MESSAGES) return `Zu viele Nachrichten (max. ${MAX_MESSAGES})`;
  let total = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object") return "Nachricht ungültig";
    if (m.role !== "user" && m.role !== "assistant") return "Nachrichten-Rolle muss 'user' oder 'assistant' sein";
    if (typeof m.content !== "string" || m.content.length === 0) return "Nachrichten-Inhalt muss ein nicht-leerer String sein";
    if (m.content.length > MAX_MESSAGE_CHARS) return `Nachricht zu lang (max. ${MAX_MESSAGE_CHARS} Zeichen)`;
    total += m.content.length;
  }
  if (total > MAX_TOTAL_CHARS) return `Gesprächsverlauf zu lang (max. ${MAX_TOTAL_CHARS} Zeichen)`;
  return null;
}

/** Liefert einen Fehlertext oder null, wenn image gültig ist. */
function validateImage(image) {
  if (typeof image !== "object") return "image ungültig";
  if (typeof image.mime !== "string" || !IMAGE_MIMES.has(image.mime)) return "Nur JPG, PNG, WebP, GIF oder PDF werden unterstützt";
  if (typeof image.data !== "string" || image.data.length === 0) return "Bilddaten fehlen";
  if (image.data.length > MAX_IMAGE_B64_CHARS) return "Datei zu groß (max. 4 MB) — bitte ein kleineres Foto machen oder das PDF aufteilen";
  if (image.data.length % 4 !== 0 || !B64_RE.test(image.data)) return "Bilddaten sind kein gültiges Base64";
  return null;
}

/** Deckelt max_tokens serverseitig, egal was der Client schickt. */
function clampMaxTok(v) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return MAX_TOKENS_DEFAULT;
  return Math.min(n, MAX_TOKENS_HARD_CAP);
}

/** Upstream-Status durchreichen, aber nie als Erfolg maskieren. */
function upstreamStatus(status) {
  return status >= 400 && status <= 599 ? status : 502;
}

async function fetchWithTimeout(url, init) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Verify a Neon Auth JWT against the JWKS and return its `sub` (user id), or null.
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

export const config = { path: "/.netlify/functions/ai-proxy" };
