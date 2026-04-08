#!/usr/bin/env python3
"""
StudyBuddy Pro — Schul-Import aus jedeschule.codefor.de API
============================================================
Umgebungsvariablen (GitHub Secrets):
  SUPABASE_URL          z.B. https://xyz.supabase.co
  SUPABASE_SERVICE_KEY  service_role / secret key
"""

import os
import sys
import time
import json
import requests

# ── Konfiguration ──────────────────────────────────────────────────────────────
JEDESCHULE_API = "https://jedeschule.codefor.de/schools/"
PAGE_SIZE      = 200
MAX_RETRIES    = 3
UPSERT_BATCH   = 100

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

print("=" * 60)
print("StudyBuddy — Schulen-Import")
print("=" * 60)

# ── Secrets prüfen ─────────────────────────────────────────────────────────────
if not SUPABASE_URL:
    print("❌ SUPABASE_URL fehlt!")
    sys.exit(1)
if not SUPABASE_KEY:
    print("❌ SUPABASE_SERVICE_KEY fehlt!")
    sys.exit(1)

print(f"✅ SUPABASE_URL:         {SUPABASE_URL}")
print(f"✅ SUPABASE_SERVICE_KEY: {SUPABASE_KEY[:12]}... (gesetzt)")
print()

# ── Supabase Headers ───────────────────────────────────────────────────────────
HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "resolution=merge-duplicates",
}

# ── Schritt 1: Supabase-Verbindung testen ─────────────────────────────────────
print("🔌 Teste Supabase-Verbindung ...")
test_url = f"{SUPABASE_URL}/rest/v1/schools?select=id&limit=1"
try:
    r = requests.get(test_url, headers=HEADERS, timeout=15)
    print(f"   Status: {r.status_code}")
    if r.status_code == 200:
        print("   ✅ Supabase 'schools'-Tabelle erreichbar")
    elif r.status_code == 404:
        print("   ❌ Tabelle 'schools' existiert nicht!")
        print("   → Bitte zuerst Migration 006 im Supabase SQL Editor ausführen.")
        sys.exit(1)
    elif r.status_code in (401, 403):
        print(f"   ❌ Authentifizierungsfehler: {r.text}")
        print("   → Bitte SUPABASE_SERVICE_KEY prüfen (service_role / secret key benötigt).")
        sys.exit(1)
    else:
        print(f"   ⚠️  Unerwarteter Status: {r.status_code} — {r.text[:200]}")
        sys.exit(1)
except Exception as e:
    print(f"   ❌ Verbindung fehlgeschlagen: {e}")
    sys.exit(1)

print()

# ── Schritt 2: jedeschule API abrufen ─────────────────────────────────────────
print(f"📥 Lade Schulen von {JEDESCHULE_API} ...")

def fetch_page(offset):
    url = f"{JEDESCHULE_API}?limit={PAGE_SIZE}&offset={offset}"
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, timeout=30)
            print(f"   offset={offset} → HTTP {r.status_code}")
            if r.status_code != 200:
                print(f"   Antwort: {r.text[:300]}")
                return []
            data = r.json()
            # Manche API-Versionen geben {"items": [...]} statt direkt eine Liste
            if isinstance(data, dict):
                data = data.get("items") or data.get("schools") or data.get("data") or []
            return data if isinstance(data, list) else []
        except Exception as e:
            print(f"   Versuch {attempt}/{MAX_RETRIES} fehlgeschlagen: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(3)
    return []

all_schools = []
offset = 0
while True:
    page = fetch_page(offset)
    if not page:
        print(f"   Seite leer bei offset={offset} — fertig")
        break
    all_schools.extend(page)
    print(f"   {len(all_schools)} Schulen bisher geladen ...")
    if len(page) < PAGE_SIZE:
        break
    offset += PAGE_SIZE
    time.sleep(0.5)

print(f"\n✅ {len(all_schools)} Schulen gesamt geladen")

if not all_schools:
    print("⚠️  Keine Daten von jedeschule API erhalten.")
    print("   API könnte vorübergehend nicht verfügbar sein.")
    print("   Erster Datensatz (falls vorhanden):", all_schools[:1])
    sys.exit(1)

# Ersten Datensatz anzeigen (Debugging)
print(f"\n📋 Beispiel-Datensatz (Felder): {list(all_schools[0].keys())}")
print(f"   Werte: {json.dumps(all_schools[0], ensure_ascii=False)[:300]}")
print()

# ── Schritt 3: Transformieren ─────────────────────────────────────────────────
STATE_MAP = {
    "berlin":"BE","brandenburg":"BB","sachsen":"SN","thueringen":"TH",
    "hamburg":"HH","bremen":"HB","mecklenburg-vorpommern":"MV",
    "sachsen-anhalt":"ST","niedersachsen":"NI","nordrhein-westfalen":"NW",
    "hessen":"HE","rheinland-pfalz":"RP","saarland":"SL",
    "bayern":"BY","schleswig-holstein":"SH","baden-wuerttemberg":"BW",
    "baden-württemberg":"BW","thüringen":"TH",
}

def norm_state(raw):
    k = str(raw).lower().strip()
    return STATE_MAP.get(k, str(raw).upper()[:2])

def transform(s):
    sid  = str(s.get("id") or "").strip()
    name = str(s.get("name") or "").strip()
    city = str(s.get("city") or s.get("ort") or "").strip()
    if not sid or not name or not city:
        return None
    return {
        "id":          sid,
        "name":        name,
        "address":     (s.get("address") or s.get("adresse") or "")[:200] or None,
        "zip":         (s.get("zip") or s.get("plz") or "")[:10] or None,
        "city":        city[:100],
        "state":       norm_state(s.get("state") or s.get("bundesland") or ""),
        "school_type": (s.get("school_type") or s.get("schulart") or "")[:100] or None,
        "provider":    (s.get("provider") or s.get("traeger") or "")[:50] or None,
        "website":     s.get("website") or None,
        "phone":       s.get("phone") or s.get("telefon") or None,
        "email":       s.get("email") or None,
        "source":      "jedeschule",
    }

rows = [r for s in all_schools if (r := transform(s))]
print(f"✅ {len(rows)} gültige Datensätze ({len(all_schools)-len(rows)} übersprungen)")

# ── Schritt 4: Upsert in Supabase ─────────────────────────────────────────────
print(f"\n📤 Upsert in Supabase ({UPSERT_BATCH} pro Batch) ...")
upsert_url = f"{SUPABASE_URL}/rest/v1/schools"
success = 0

for i in range(0, len(rows), UPSERT_BATCH):
    batch = rows[i:i+UPSERT_BATCH]
    try:
        r = requests.post(upsert_url, headers=HEADERS, json=batch, timeout=30)
        if r.status_code in (200, 201):
            success += len(batch)
            print(f"   ✓ {success}/{len(rows)}", end="\r")
        else:
            print(f"\n   ❌ Batch {i//UPSERT_BATCH+1} Fehler: {r.status_code} — {r.text[:300]}")
    except Exception as e:
        print(f"\n   ❌ Batch {i//UPSERT_BATCH+1} Exception: {e}")

print(f"\n\n🎉 Fertig: {success}/{len(rows)} Schulen importiert")

if success == 0:
    print("❌ Kein einziger Datensatz importiert — Import fehlgeschlagen")
    sys.exit(1)

# Statistik
by_state = {}
for r in rows:
    by_state[r["state"]] = by_state.get(r["state"], 0) + 1
print("\nNach Bundesland:")
for st, cnt in sorted(by_state.items(), key=lambda x: -x[1]):
    print(f"  {st}: {cnt}")
