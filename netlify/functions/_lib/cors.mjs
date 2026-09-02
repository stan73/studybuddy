/**
 * CORS-Helfer für die StudyBuddy-Functions.
 * Erlaubt nur die eigenen Origins (kein Wildcard). Der App-Client ruft die
 * Functions same-origin auf; die Liste deckt Produktion, Netlify-Previews
 * (URL / DEPLOY_PRIME_URL / DEPLOY_URL) und `netlify dev` ab.
 * Weitere Origins per Env ALLOWED_ORIGINS (kommasepariert).
 */
const DEFAULT_ORIGINS = [
  "https://gleaming-gaufre-b15c11.netlify.app",
  "http://localhost:8888",
  "http://127.0.0.1:8888",
];

export function allowedOrigins() {
  const set = new Set(DEFAULT_ORIGINS);
  for (const v of [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL]) {
    if (typeof v === "string" && v) set.add(v.replace(/\/+$/, ""));
  }
  for (const o of (process.env.ALLOWED_ORIGINS || "").split(",")) {
    const t = o.trim().replace(/\/+$/, "");
    if (t) set.add(t);
  }
  return set;
}

/** Header-Objekt für die Antwort; Allow-Origin nur bei erlaubtem Origin. */
export function corsHeaders(req) {
  const origin = req.headers.get("origin");
  const h = {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && allowedOrigins().has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
