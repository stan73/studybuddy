// StudyBuddy Pro — KI-Proxy Edge Function
// Version 2.0 | Deno · Supabase Edge Functions
//
// Zweck: API-Keys sicher server-seitig aufbewahren und alle KI-Anfragen proxyen.
// Unterstützte Provider: Claude (Anthropic), OpenAI (GPT), Google Gemini
//
// Deploy: supabase functions deploy ai-proxy --project-ref qzmviwrpyfpjahcmbjoy

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Model-Konfiguration (spiegelt PROVIDERS in app.html)
const MODELS: Record<string, string> = {
  claude: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const {
      provider,
      messages,
      system,
      maxTok = 400,
      // Nur für Kind-Sessions (kein Supabase-JWT): Key direkt übergeben
      apiKey: passedKey,
    } = body;

    if (!provider || !messages) return err(400, "provider und messages erforderlich");
    if (!MODELS[provider]) return err(400, `Unbekannter Provider: ${provider}`);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    let apiKey: string | null = passedKey || null;

    // Authentifizierter Nutzer: Key aus der Datenbank laden
    if (!apiKey) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return err(401, "Nicht autorisiert — bitte einloggen");

      const {
        data: { user },
        error: authErr,
      } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (authErr || !user) return err(401, "Ungültiger Session-Token");

      const { data: keyRow } = await supabase
        .from("api_keys")
        .select("api_key")
        .eq("user_id", user.id)
        .eq("provider", provider)
        .maybeSingle();

      apiKey = keyRow?.api_key ?? null;
    }

    if (!apiKey) {
      return err(
        400,
        `Kein ${provider}-API-Key konfiguriert — bitte in Einstellungen eintragen`
      );
    }

    // ── KI-Anfrage ────────────────────────────────────────────────────────────
    let text = "";

    if (provider === "claude") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODELS.claude,
          max_tokens: maxTok,
          system,
          messages,
        }),
      });
      const d = await r.json();
      if (!r.ok) return err(r.status, d?.error?.message ?? r.statusText);
      text = d.content?.[0]?.text ?? "";
    } else if (provider === "openai") {
      const msgs = system
        ? [{ role: "system", content: system }, ...messages]
        : messages;
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: MODELS.openai, max_tokens: maxTok, messages: msgs }),
      });
      const d = await r.json();
      if (!r.ok) return err(r.status, d?.error?.message ?? r.statusText);
      text = d.choices?.[0]?.message?.content ?? "";
    } else if (provider === "gemini") {
      const contents = messages.map(
        (m: { role: string; content: string }) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })
      );
      if (system) contents.unshift({ role: "user", parts: [{ text: system }] });
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent?key=${apiKey}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: maxTok },
        }),
      });
      const d = await r.json();
      if (!r.ok) return err(r.status, d?.error?.message ?? r.statusText);
      text = d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }

    return new Response(JSON.stringify({ text }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return err(500, e instanceof Error ? e.message : "Interner Serverfehler");
  }
});

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
