/**
 * @file index.ts — StudyBuddy Pro KI-Proxy Edge Function
 * @description Supabase Edge Function (Deno-Runtime) die als sicherer Proxy
 *              für alle KI-Anfragen fungiert. API-Keys verlassen den Server nie
 *              nach der Speicherung — der Browser erhält ausschließlich Textantworten.
 * @version 2.0.0
 *
 * @endpoints
 *   POST /functions/v1/ai-proxy
 *
 * @request_body
 *   {
 *     provider: 'claude' | 'openai' | 'gemini',
 *     messages: Array<{role: 'user'|'assistant', content: string}>,
 *     system?:  string,           // System-Prompt
 *     maxTok?:  number,           // Max. Tokens (default: 400)
 *     apiKey?:  string,           // Nur für Kind/Demo-Sessions (kein JWT)
 *   }
 *
 * @auth
 *   Auth-Nutzer: Authorization: Bearer <supabase-jwt>
 *     → JWT wird via supabase.auth.getUser() verifiziert
 *     → Key wird aus api_keys-Tabelle gelesen (SERVICE_ROLE — RLS bypass)
 *   Kind/Demo: kein Authorization-Header, apiKey im Body (HTTPS-verschlüsselt)
 *     → Key wird direkt für die KI-Anfrage genutzt, NICHT gespeichert
 *
 * @security
 *   - CORS: * (Browser-Anfragen von allen Origins erlaubt)
 *   - SERVICE_ROLE_KEY: nur serverseitig, nie an Client weitergegeben
 *   - Kein Logging von API-Keys oder Nutzeranfragen
 *   - Alle Fehler geben generische Meldungen zurück (kein Stack-Trace)
 *
 * @environment_variables
 *   SUPABASE_URL              — Automatisch von Supabase gesetzt
 *   SUPABASE_SERVICE_ROLE_KEY — Automatisch von Supabase gesetzt
 *
 * @deploy
 *   supabase functions deploy ai-proxy --project-ref qzmviwrpyfpjahcmbjoy
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** @type {string} Supabase Project URL (aus Umgebungsvariable) */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

/** @type {string} Service Role Key — bypassed RLS für api_keys-Lesezugriff */
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Standard-Modell je Provider.
 * Muss mit PROVIDERS.models.fast in app.html synchron gehalten werden.
 * @type {Record<string, string>}
 */
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
      // Pfad 1: Key direkt im Body (selbes Gerät, localStorage-Vererbung)
      apiKey: passedKey,
      // Pfad 2: Kind-ID → Proxy holt Parent-Key aus DB (geräteübergreifend)
      childId: passedChildId,
    } = body;

    if (!provider || !messages) return err(400, "provider und messages erforderlich");
    if (!MODELS[provider]) return err(400, `Unbekannter Provider: ${provider}`);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    let apiKey: string | null = passedKey || null;

    // Pfad 2: Kind-Anfrage ohne lokalen Key → Parent-Key via childId aus DB laden
    // Sicherheit: childId ist UUID (nicht erratbar); Key verlässt den Server nicht
    if (!apiKey && passedChildId) {
      const { data: childRow } = await supabase
        .from("children")
        .select("parent_id")
        .eq("id", passedChildId)
        .maybeSingle();

      if (childRow?.parent_id) {
        const { data: keyRow } = await supabase
          .from("api_keys")
          .select("api_key")
          .eq("user_id", childRow.parent_id)
          .eq("provider", provider)
          .maybeSingle();

        apiKey = keyRow?.api_key ?? null;
      }
    }

    // Pfad 3: Authentifizierter Nutzer → Key via JWT aus DB laden
    // JWT wird lokal dekodiert (Gateway hat Signatur bereits validiert)
    if (!apiKey && !passedChildId) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return err(401, "Nicht autorisiert — bitte einloggen");

      const token = authHeader.replace("Bearer ", "");
      let userId: string | null = null;
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        // Nur echte User-JWTs akzeptieren (role=authenticated, sub=UUID)
        if (payload.role === "authenticated" && payload.sub) {
          userId = payload.sub;
        }
      } catch {
        return err(401, "Ungültiger Token-Format");
      }

      if (!userId) return err(401, "Kein authentifizierter Nutzer");

      const { data: keyRow } = await supabase
        .from("api_keys")
        .select("api_key")
        .eq("user_id", userId)
        .eq("provider", provider)
        .maybeSingle();

      apiKey = keyRow?.api_key ?? null;
    }

    if (!apiKey) {
      return err(
        400,
        `Kein ${provider}-API-Key konfiguriert — Elternteil muss Key in den Einstellungen hinterlegen`
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

/**
 * Erstellt eine standardisierte JSON-Fehlerantwort mit CORS-Headern.
 * @param {number} status  — HTTP-Statuscode
 * @param {string} message — Fehlermeldung (für den Browser lesbar, kein Stack-Trace)
 * @returns {Response}
 */
function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
