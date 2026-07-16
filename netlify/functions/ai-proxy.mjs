/**
 * ai-proxy — StudyBuddy KI-Proxy (Netlify Function, Neon-Backend)
 * Sicherer Proxy für KI-Anfragen. API-Keys verlassen den Server nie.
 * Ersetzt die frühere Supabase Edge Function 1:1 (Neon statt Supabase,
 * JWT-Verifikation gegen die Neon-Auth-JWKS, Free-Tier-Tageslimit).
 */
import { neon } from "@neondatabase/serverless";
import { createRemoteJWKSet, jwtVerify } from "jose";

const sql = neon(process.env.DATABASE_URL);
const JWKS = createRemoteJWKSet(new URL(process.env.NEON_JWKS_URL));
const FREE_DAILY_LIMIT = 20;

const MODELS = {
  claude: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return err(405, "Method Not Allowed");

  try {
    const body = await req.json();
    const { provider, messages, system, maxTok = 400, apiKey: passedKey, childId, image } = body;

    if (!provider || !messages) return err(400, "provider und messages erforderlich");
    if (!MODELS[provider]) return err(400, `Unbekannter Provider: ${provider}`);

    let apiKey = passedKey || null;

    // Account-Inhaber für Free-Tier-Limit (Kind → Elternteil; sonst verifizierter JWT-sub)
    let ownerId = null;
    if (childId) {
      const rows = await sql`select parent_id from children where id = ${childId}::uuid`;
      ownerId = rows[0]?.parent_id ?? null;
    } else {
      ownerId = await verifiedSub(req);
    }

    // API-Key aus der DB auflösen (Kind → Key des Elternteils)
    if (!apiKey && childId && ownerId) {
      const rows = await sql`select api_key from api_keys where user_id = ${ownerId}::uuid and provider = ${provider}`;
      apiKey = rows[0]?.api_key ?? null;
    }
    if (!apiKey && !childId) {
      if (!ownerId) return err(401, "Nicht autorisiert — bitte einloggen");
      const rows = await sql`select api_key from api_keys where user_id = ${ownerId}::uuid and provider = ${provider}`;
      apiKey = rows[0]?.api_key ?? null;
    }

    if (!apiKey) {
      return err(400, `Kein ${provider}-API-Key konfiguriert — Elternteil muss Key in den Einstellungen hinterlegen`);
    }

    // Free-Tier-Limit
    if (ownerId) {
      const prof = await sql`select subscription from profiles where id = ${ownerId}::uuid`;
      if ((prof[0]?.subscription ?? "free") === "free") {
        const q = await sql`select consume_ai_quota(${ownerId}::uuid, ${FREE_DAILY_LIMIT}) as allowed`;
        if (q[0]?.allowed === false) {
          return err(429, `Tageslimit erreicht (${FREE_DAILY_LIMIT} KI-Anfragen/Tag im Gratis-Tarif). Upgrade für unbegrenzte Anfragen.`);
        }
      }
    }

    let text = "";

    if (provider === "claude") {
      const claudeMsgs = image
        ? messages.map((m, i) =>
            i === messages.length - 1 && m.role === "user"
              ? {
                  role: "user",
                  content: [
                    { type: "text", text: m.content },
                    image.mime === "application/pdf"
                      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: image.data } }
                      : { type: "image", source: { type: "base64", media_type: image.mime, data: image.data } },
                  ],
                }
              : m,
          )
        : messages;
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODELS.claude, max_tokens: maxTok, system, messages: claudeMsgs }),
      });
      const d = await r.json();
      if (!r.ok) return err(r.status, d?.error?.message ?? r.statusText);
      text = d.content?.[0]?.text ?? "";
    } else if (provider === "openai") {
      const oaiMsgs = image
        ? messages.map((m, i) =>
            i === messages.length - 1 && m.role === "user"
              ? {
                  role: "user",
                  content: [
                    { type: "text", text: m.content },
                    { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } },
                  ],
                }
              : m,
          )
        : messages;
      const msgs = system ? [{ role: "system", content: system }, ...oaiMsgs] : oaiMsgs;
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: MODELS.openai, max_tokens: maxTok, messages: msgs }),
      });
      const d = await r.json();
      if (!r.ok) return err(r.status, d?.error?.message ?? r.statusText);
      text = d.choices?.[0]?.message?.content ?? "";
    } else if (provider === "gemini") {
      const contents = messages.map((m, i) => {
        const parts = [{ text: m.content }];
        if (image && i === messages.length - 1 && m.role === "user") parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
        return { role: m.role === "assistant" ? "model" : "user", parts };
      });
      if (system) contents.unshift({ role: "user", parts: [{ text: system }] });
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent?key=${apiKey}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTok } }),
      });
      const d = await r.json();
      if (!r.ok) return err(r.status, d?.error?.message ?? r.statusText);
      text = d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }

    return new Response(JSON.stringify({ text }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "Interner Serverfehler");
  }
};

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

function err(status, message) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export const config = { path: "/.netlify/functions/ai-proxy" };
