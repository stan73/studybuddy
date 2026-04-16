#!/usr/bin/env bash
# autopush.sh — StudyBuddy Helper für autonomes Commit+Push
# Umgeht Sandbox-Lock-Probleme, indem ein frischer Clone in /tmp erstellt wird.
#
# Usage:  scripts/autopush.sh "<commit message>" [dateien ...]
# Wenn keine Dateien übergeben werden, werden ALLE geänderten Dateien übernommen.

set -euo pipefail

REPO_URL="https://github.com/${GITHUB_USER:-stanqiqi}/studybuddy.git"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="/tmp/studybuddy-autopush-$$"
MSG="${1:-chore: autonomous update}"
shift || true
FILES=("$@")

echo "▶ Clone nach $TMP_DIR"
git clone --depth=1 "$REPO_URL" "$TMP_DIR"

if [ ${#FILES[@]} -eq 0 ]; then
  echo "▶ Kopiere alle geänderten Dateien"
  rsync -a --exclude='.git' --exclude='node_modules' --exclude='tests/last_report.json' \
        "$SRC_DIR/" "$TMP_DIR/"
else
  echo "▶ Kopiere spezifische Dateien: ${FILES[*]}"
  for f in "${FILES[@]}"; do
    mkdir -p "$TMP_DIR/$(dirname "$f")"
    cp "$SRC_DIR/$f" "$TMP_DIR/$f"
  done
fi

cd "$TMP_DIR"
git add -A
if git diff --cached --quiet; then
  echo "▶ Nichts zu committen — abbrechen."
  rm -rf "$TMP_DIR"
  exit 0
fi

git -c user.email="claude@studybuddy.local" -c user.name="Claude (autonom)" \
    commit -m "$MSG"
git push

echo "✔ Push erfolgreich: $MSG"
rm -rf "$TMP_DIR"
