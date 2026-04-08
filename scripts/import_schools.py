#!/usr/bin/env python3
"""
StudyBuddy Pro — Schul-Import aus jedeschule.codefor.de API
============================================================
Lädt alle deutschen Schulen aus der jedeschule API und schreibt
sie per Upsert in die Supabase-Tabelle `schools`.

Umgebungsvariablen (als GitHub Secrets hinterlegen):
  SUPABASE_URL          z.B. https://xyz.supabase.co
  SUPABASE_SERVICE_KEY  service_role key (nicht der anon key!)

Lokaler Test:
  export SUPABASE_URL=...
  export SUPABASE_SERVICE_KEY=...
  python3 scripts/import_schools.py
"""

import os
import sys
import json
import time
import requests

# ── Konfiguration ──────────────────────────────────────────────
JEDESCHULE_API  = "https://jedeschule.codefor.de/schools/"
PAGE_SIZE       = 500          # Max items pro Anfrage
MAX_RETRIES     = 3
RETRY_DELAY     = 5            # Sekunden zwischen Retries
UPSERT_BATCH    = 200          # Rows pro Supabase-Upsert

SUPABASE_URL     = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY     = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ SUPABASE_URL und SUPABASE_SERVICE_KEY müssen gesetzt sein.")
    sys.exit(1)

SUPABASE_HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "resolution=merge-duplicates",  # Upsert
}

# ── Bundesland-Mapping (jedeschule state codes → Kürzel) ───────
STATE_MAP = {
    "berlin":              "BE",
    "brandenburg":         "BB",
    "sachsen":             "SN",
    "thueringen":          "TH",
    "hamburg":             "HH",
    "bremen":              "HB",
    "mecklenburg-vorpommern": "MV",
    "sachsen-anhalt":      "ST",
    "niedersachsen":       "NI",
    "nordrhein-westfalen": "NW",
    "hessen":              "HE",
    "rheinland-pfalz":     "RP",
    "saarland":            "SL",
    "bayern":              "BY",
    "schleswig-holstein":  "SH",
    "baden-wuerttemberg":  "BW",
}


def normalize_state(raw: str) -> str:
    """Konvertiert Bundesland-String in zweistelliges Kürzel."""
    key = raw.lower().replace("ü", "ue").replace("ä", "ae").replace("ö", "oe").strip()
    return STATE_MAP.get(key, raw.upper()[:2])


def fetch_page(offset: int) -> list[dict]:
    """Holt eine Seite Schulen von der jedeschule API."""
    url = f"{JEDESCHULE_API}?limit={PAGE_SIZE}&offset={offset}"
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"  ⚠️  Versuch {attempt}/{MAX_RETRIES} fehlgeschlagen: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
    print(f"  ❌ Seite bei offset={offset} konnte nicht geladen werden.")
    return []


def transform(school: dict) -> dict | None:
    """Mappt jedeschule-Felder auf unsere schools-Tabelle."""
    sid = school.get("id", "").strip()
    name = school.get("name", "").strip()
    city = (school.get("city") or school.get("ort") or "").strip()
    state_raw = school.get("state") or school.get("bundesland") or ""

    if not sid or not name or not city:
        return None  # Unvollständige Datensätze überspringen

    return {
        "id":          sid,
        "name":        name,
        "address":     (school.get("address") or school.get("adresse") or "").strip() or None,
        "zip":         (school.get("zip") or school.get("plz") or "").strip() or None,
        "city":        city,
        "state":       normalize_state(state_raw),
        "school_type": (school.get("school_type") or school.get("schulart") or "").strip() or None,
        "provider":    (school.get("provider") or school.get("traeger") or "").strip() or None,
        "website":     school.get("website") or None,
        "phone":       school.get("phone") or school.get("telefon") or None,
        "email":       school.get("email") or None,
        "source":      "jedeschule",
    }


def upsert_batch(rows: list[dict]) -> bool:
    """Schreibt einen Batch per Upsert in Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/schools"
    r = requests.post(url, headers=SUPABASE_HEADERS, json=rows, timeout=30)
    if r.status_code not in (200, 201):
        print(f"  ❌ Supabase Upsert fehlgeschlagen: {r.status_code} {r.text[:200]}")
        return False
    return True


def main():
    print("🏫 StudyBuddy — Schulen-Import startet")
    print(f"   Quelle: {JEDESCHULE_API}")
    print(f"   Ziel:   {SUPABASE_URL}/rest/v1/schools\n")

    all_schools: list[dict] = []
    offset = 0

    # ── Alle Seiten laden ──────────────────────────────────────
    while True:
        print(f"📥 Lade Schulen {offset}–{offset + PAGE_SIZE} ...", end=" ", flush=True)
        page = fetch_page(offset)
        if not page:
            print("(leer — fertig)")
            break
        print(f"{len(page)} erhalten")
        all_schools.extend(page)
        if len(page) < PAGE_SIZE:
            break  # Letzte Seite
        offset += PAGE_SIZE
        time.sleep(0.3)  # Höfliche Pause

    print(f"\n✅ {len(all_schools)} Schulen gesamt geladen")

    # ── Transformieren ─────────────────────────────────────────
    rows = [r for s in all_schools if (r := transform(s)) is not None]
    skipped = len(all_schools) - len(rows)
    print(f"   {len(rows)} gültige Datensätze, {skipped} übersprungen (fehlende Pflichtfelder)")

    if not rows:
        print("⚠️  Keine Daten zum Importieren. Abbruch.")
        sys.exit(1)

    # ── Batched Upsert in Supabase ─────────────────────────────
    print(f"\n📤 Upsert in Supabase ({UPSERT_BATCH} Rows/Batch) ...")
    success = 0
    for i in range(0, len(rows), UPSERT_BATCH):
        batch = rows[i : i + UPSERT_BATCH]
        ok = upsert_batch(batch)
        if ok:
            success += len(batch)
            print(f"   ✓ {success}/{len(rows)} importiert", end="\r", flush=True)
        else:
            print(f"   ✗ Fehler bei Batch {i//UPSERT_BATCH + 1}")

    print(f"\n\n🎉 Import abgeschlossen: {success}/{len(rows)} Schulen in Supabase")

    # Statistik nach Bundesland
    by_state: dict[str, int] = {}
    for r in rows:
        by_state[r["state"]] = by_state.get(r["state"], 0) + 1
    print("\nSchulen nach Bundesland:")
    for state, count in sorted(by_state.items(), key=lambda x: -x[1]):
        print(f"  {state}: {count}")


if __name__ == "__main__":
    main()
