#!/usr/bin/env bash
# Publish the installers in installer-out/ as a GitHub Release so installed
# copies of Quizy update themselves (they check github.com/Snoopy941/Quizy).
#   Prereqs: GitHub CLI (https://cli.github.com), logged in: gh auth login
#   The repository must be public, or users' copies can't download updates.
# Usage: bash scripts/publish-release.sh ["release notes"]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/installer-out"
VERSION=$(node -p "require('$ROOT/installer/package.json').version")
NOTES="${1:-Quizy $VERSION}"

command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com (then run: gh auth login)"; exit 1; }
for f in "Quizy-Setup-$VERSION.exe" "Quizy-Setup-$VERSION.exe.blockmap" latest.yml; do
  [ -f "$OUT/$f" ] || { echo "Missing $OUT/$f — run build.bat first"; exit 1; }
done

ASSETS=("$OUT/Quizy-Setup-$VERSION.exe" "$OUT/Quizy-Setup-$VERSION.exe.blockmap" "$OUT/latest.yml")

echo "==> Creating release v$VERSION on $(cd "$ROOT" && git remote get-url origin)"
(cd "$ROOT" && gh release create "v$VERSION" "${ASSETS[@]}" --title "Quizy $VERSION" --notes "$NOTES")
echo "Done. Installed copies will pick this up within a few hours (or via Settings → Check for updates)."
