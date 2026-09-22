#!/usr/bin/env bash
# Build the Quizy Windows installer (NSIS) with electron-builder.
# Output: installer-out/Quizy-Setup-1.0.0.exe
# Prereqs: Node on PATH; run from repo root: bash scripts/build-installer.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INST="$ROOT/installer"
STAGE="$INST/staging"
OUT_APP="$STAGE/app"

command -v node >/dev/null || { echo "node not on PATH"; exit 1; }

echo "==> Building Next.js standalone"
(cd "$ROOT" && npx next build)

echo "==> Staging installer payload"
rm -rf "$STAGE"
mkdir -p "$OUT_APP/.next" "$STAGE/bin" "$STAGE/seed" "$STAGE/licenses"

# 1. Next.js standalone server + static + public assets + icons
cp -r "$ROOT/.next/standalone/." "$OUT_APP/"
cp -r "$ROOT/.next/static" "$OUT_APP/.next/static"
[ -d "$ROOT/public" ] && cp -r "$ROOT/public" "$OUT_APP/public"
cp "$ROOT/assets/quizy-icon.png" "$OUT_APP/quizy-icon.png"
cp "$ROOT/assets/quizy.ico" "$OUT_APP/quizy.ico"
rm -f "$OUT_APP/.env"   # launcher sets env explicitly

# 2. Node runtime for the server process
cp "/c/Program Files/nodejs/node.exe" "$STAGE/bin/node.exe"

# 3. First-run seed: demo account + its uploaded PDFs (installer/seed-demo
#    holds the canonical demo db; fall back to portable/dev folders)
if [ -f "$ROOT/installer/seed-demo/quizy.db" ]; then
  cp "$ROOT/installer/seed-demo/quizy.db" "$STAGE/seed/quizy.db"
elif [ -f "$ROOT/dist/Quizy/data/quizy.db" ]; then
  cp "$ROOT/dist/Quizy/data/quizy.db" "$STAGE/seed/quizy.db"
elif [ -f "$ROOT/prisma/data/quizy.db" ]; then
  cp "$ROOT/prisma/data/quizy.db" "$STAGE/seed/quizy.db"
fi
mkdir -p "$STAGE/seed/uploads"
if [ -d "$ROOT/installer/seed-demo/uploads" ]; then
  cp -r "$ROOT/installer/seed-demo/uploads/." "$STAGE/seed/uploads/" 2>/dev/null || true
elif [ -d "$ROOT/dist/Quizy/data/uploads" ]; then
  cp -r "$ROOT/dist/Quizy/data/uploads/." "$STAGE/seed/uploads/" 2>/dev/null || true
elif [ -f "$ROOT/data/sample.pdf" ]; then
  cp "$ROOT/data/sample.pdf" "$STAGE/seed/uploads/sample.pdf"
fi

# 4. Icons for exe/installer (electron-builder reads staging/icon.ico)
cp "$ROOT/assets/quizy.ico" "$STAGE/icon.ico"

# 5. Licenses
cp "$ROOT/installer/LICENSE.txt" "$STAGE/licenses/LICENSE.txt"
cat > "$STAGE/licenses/OPENSOURCE.txt" <<'EOF'
Quizy ships with open-source software. Credits and licenses:

- Electron / Chromium: MIT / Apache License 2.0 — https://www.electronjs.org
- Node.js: MIT License — https://nodejs.org
- Next.js: MIT License — https://nextjs.org
- React: MIT License — https://react.dev
- Prisma: Apache License 2.0 — https://www.prisma.io
- Tailwind CSS: MIT License — https://tailwindcss.com
- Framer Motion: MIT License — https://www.framer.com/motion/
- unpdf / pdf.js: Apache License 2.0 — https://github.com/unjs/unpdf
- bcryptjs: MIT License
- jose: MIT License
- canvas-confetti: ISC License
EOF

# 6. Electron entry: launcher + preload + builder config + license
cp "$ROOT/scripts/launcher.js" "$INST/index.js"
cp "$ROOT/scripts/preload.js" "$INST/preload.js"

echo "==> Installing electron-builder (first run downloads ~100MB)"
(cd "$INST" && npm i --no-audit --no-fund 2>&1 | tail -1)

echo "==> Building installer + portable exe"
(cd "$INST" && npx electron-builder --win nsis portable --x64 2>&1 | tail -25)

mkdir -p "$ROOT/installer-out"
cp "$INST"/installer-out/Quizy-Setup-*.exe "$ROOT/installer-out/" 2>/dev/null || true
cp "$INST"/installer-out/Quizy-*.exe "$ROOT/installer-out/" 2>/dev/null || true
echo ""
ls -la "$ROOT"/installer-out/ 2>/dev/null
