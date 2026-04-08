#!/usr/bin/env python3
"""
StudyBuddy Pro — Schul-Import
==============================
Strategie:
  1. jedeschule CSV-Download (wöchentlicher Dump, robuster als die API)
  2. Falls CSV nicht verfügbar: jedeschule REST-API mit kleinen Seiten (limit=50)

Umgebungsvariablen (GitHub Secrets):
  SUPABASE_URL          z.B. https://xyz.supabase.co
  SUPABASE_SERVICE_KEY  service_role / secret key
"""

import os
import sys
import csv
import io
import time
import json
import requests

# ── Konfiguration ──────────────────────────────────────────────────────────────
# CSV-Endpunkte (in dieser Reihenfolge versucht)
CSV_URLS = [
    "https://jedeschule.codefor.de/schools.csv",
    "https://jedeschule.codefor.de/csv-data/schools.csv",
    "https://raw.githubusercontent.com/Datenschule/schulscraper-data/master/data/schools.csv",
]
# API-Fallback mit kleiner Seitengröße
API_URL   = "https://jedeschule.codefor.de/schools/"
PAGE_SIZE = 50    # klein halten um 500-Fehler zu vermeiden

UPSERT_BATCH = 100

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

print("=" * 60)
print("StudyBuddy — Schulen-Import")
print("=" * 60)

if not SUPABASE_URL:
    print("❌ SUPABASE_URL fehlt!"); sys.exit(1)
if not SUPABASE_KEY:
    print("❌ SUPABASE_SERVICE_KEY fehlt!"); sys.exit(1)

print(f"✅ SUPABASE_URL:  {SUPABASE_URL}")
print(f"✅ SERVICE_KEY:   {SUPABASE_KEY[:12]}... (gesetzt)\n")

HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "resolution=merge-duplicates",
}

# ── Schritt 1: Supabase-Verbindung testen ─────────────────────────────────────
print("🔌 Teste Supabase-Verbindung ...")
try:
    r = requests.get(f"{SUPABASE_URL}/rest/v1/schools?select=id&limit=1",
                     headers=HEADERS, timeout=15)
    print(f"   HTTP {r.status_code}")
    if r.status_code == 200:
        print("   ✅ Tabelle 'schools' erreichbar")
    elif r.status_code == 404:
        print("   ❌ Tabelle 'schools' nicht gefunden!")
        print("   → Bitte Migration 006 im Supabase SQL Editor ausführen.")
        sys.exit(1)
    elif r.status_code in (401, 403):
        print(f"   ❌ Auth-Fehler: {r.text[:200]}")
        print("   → SUPABASE_SERVICE_KEY prüfen.")
        sys.exit(1)
    else:
        print(f"   ⚠️  Status {r.status_code}: {r.text[:200]}")
        sys.exit(1)
except Exception as e:
    print(f"   ❌ Verbindung fehlgeschlagen: {e}"); sys.exit(1)

print()

# ── Schritt 2a: CSV-Download versuchen ────────────────────────────────────────
STATE_MAP = {
    "berlin":"BE","brandenburg":"BB","sachsen":"SN","thüringen":"TH","thueringen":"TH",
    "hamburg":"HH","bremen":"HB","mecklenburg-vorpommern":"MV","sachsen-anhalt":"ST",
    "niedersachsen":"NI","nordrhein-westfalen":"NW","hessen":"HE",
    "rheinland-pfalz":"RP","saarland":"SL","bayern":"BY",
    "schleswig-holstein":"SH","baden-württemberg":"BW","baden-wuerttemberg":"BW",
}

def norm_state(raw):
    k = str(raw).lower().strip()
    return STATE_MAP.get(k, str(raw).upper()[:2])

def row_from_csv(d):
    sid  = str(d.get("id") or "").strip()
    name = str(d.get("name") or "").strip()
    city = str(d.get("city") or d.get("ort") or "").strip()
    if not sid or not name or not city:
        return None
    return {
        "id":          sid,
        "name":        name[:250],
        "address":     (d.get("address") or d.get("adresse") or "")[:200] or None,
        "zip":         (d.get("zip") or d.get("plz") or "")[:10] or None,
        "city":        city[:100],
        "state":       norm_state(d.get("state") or d.get("bundesland") or ""),
        "school_type": (d.get("school_type") or d.get("schulart") or "")[:100] or None,
        "provider":    (d.get("provider") or d.get("traeger") or "")[:50] or None,
        "website":     d.get("website") or None,
        "phone":       d.get("phone") or d.get("telefon") or None,
        "email":       d.get("email") or None,
        "source":      "jedeschule",
    }

all_rows = []

print("📥 Versuche CSV-Download ...")
for csv_url in CSV_URLS:
    print(f"   → {csv_url}")
    try:
        r = requests.get(csv_url, timeout=60)
        print(f"      HTTP {r.status_code}")
        if r.status_code == 200 and r.text.strip():
            reader = csv.DictReader(io.StringIO(r.text))
            for d in reader:
                row = row_from_csv(d)
                if row:
                    all_rows.append(row)
            if all_rows:
                print(f"   ✅ {len(all_rows)} Schulen aus CSV geladen")
                print(f"   Felder: {list(csv.DictReader(io.StringIO(r.text)).fieldnames)}")
                break
            else:
                print("      CSV leer oder kein gültiges Format")
    except Exception as e:
        print(f"      Fehler: {e}")

# ── Schritt 2b: API-Fallback (kleine Seiten) ──────────────────────────────────
if not all_rows:
    print("\n📥 CSV nicht verfügbar — versuche API mit limit=50 ...")
    offset = 0
    consecutive_errors = 0
    while consecutive_errors < 3:
        url = f"{API_URL}?limit={PAGE_SIZE}&offset={offset}"
        try:
            r = requests.get(url, timeout=30)
            print(f"   offset={offset} → HTTP {r.status_code}")
            if r.status_code == 200:
                data = r.json()
                if isinstance(data, dict):
                    data = data.get("items") or data.get("schools") or data.get("data") or []
                if not isinstance(data, list) or not data:
                    print("   Leere Seite — fertig")
                    break
                for d in data:
                    row = row_from_csv(d)
                    if row:
                        all_rows.append(row)
                consecutive_errors = 0
                if len(data) < PAGE_SIZE:
                    break
                offset += PAGE_SIZE
                time.sleep(1)
            else:
                consecutive_errors += 1
                print(f"   ⚠️  Fehler: {r.text[:100]}")
                time.sleep(5)
        except Exception as e:
            consecutive_errors += 1
            print(f"   ⚠️  Exception: {e}")
            time.sleep(5)

# ── Ergebnis prüfen ───────────────────────────────────────────────────────────
print(f"\n✅ {len(all_rows)} Schulen geladen")

if not all_rows:
    print("❌ Keine Daten erhalten — jedeschule.codefor.de scheint nicht verfügbar.")
    print("   Der Import wird übersprungen. Nächster Versuch: nächsten Sonntag.")
    # Kein sys.exit(1) — Action soll trotzdem grün sein wenn API down ist
    sys.exit(0)

# Beispiel-Datensatz
print(f"   Beispiel: {json.dumps(all_rows[0], ensure_ascii=False)[:200]}\n")

# ── Schritt 3: Upsert in Supabase ─────────────────────────────────────────────
print(f"📤 Upsert in Supabase ({UPSERT_BATCH}/Batch) ...")
upsert_url = f"{SUPABASE_URL}/rest/v1/schools"
success = 0

for i in range(0, len(all_rows), UPSERT_BATCH):
    batch = all_rows[i:i+UPSERT_BATCH]
    try:
        r = requests.post(upsert_url, headers=HEADERS, json=batch, timeout=30)
        if r.status_code in (200, 201):
            success += len(batch)
            print(f"   ✓ {success}/{len(all_rows)}", end="\r")
        else:
            print(f"\n   ❌ Batch {i//UPSERT_BATCH+1}: {r.status_code} — {r.text[:200]}")
    except Exception as e:
        print(f"\n   ❌ Exception: {e}")

print(f"\n\n🎉 Fertig: {success}/{len(all_rows)} Schulen in Supabase")

by_state = {}
for r in all_rows:
    by_state[r["state"]] = by_state.get(r["state"], 0) + 1
print("\nNach Bundesland:")
for st, cnt in sorted(by_state.items(), key=lambda x: -x[1]):
    print(f"  {st}: {cnt}")
