#!/usr/bin/env bash
# Build the Quizy Windows installer (NSIS) with electron-builder.
# Output: installer-out/Quizy-Setup-<version>.exe
# Prereqs: Node on PATH, internet for the first run (downloads ~2 GB of AI
# assets, cached in installer/cache). Run from repo root:
#   bash scripts/build-installer.sh
# Set QUIZY_BUNDLE_AI=0 to build without the built-in AI (~130 MB installer).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INST="$ROOT/installer"
STAGE="$INST/staging"
OUT_APP="$STAGE/app"

command -v node >/dev/null || { echo "node not on PATH"; exit 1; }

echo "==> Installing dependencies"
(cd "$ROOT" && npm install --no-audit --no-fund 2>&1 | tail -1)
(cd "$ROOT" && npx prisma generate >/dev/null)

echo "==> Building Next.js standalone"
(cd "$ROOT" && npx next build)

echo "==> Staging installer payload"
rm -rf "$STAGE"
mkdir -p "$OUT_APP/.next" "$STAGE/bin" "$STAGE/seed" "$STAGE/licenses" "$STAGE/ai"

# 1. Next.js standalone server + static + public assets + icons
cp -r "$ROOT/.next/standalone/." "$OUT_APP/"
cp -r "$ROOT/.next/static" "$OUT_APP/.next/static"
[ -d "$ROOT/public" ] && cp -r "$ROOT/public" "$OUT_APP/public"
cp "$ROOT/assets/quizy-icon.png" "$OUT_APP/quizy-icon.png"
cp "$ROOT/assets/quizy.ico" "$OUT_APP/quizy.ico"
rm -f "$OUT_APP/.env"   # launcher sets env explicitly
# OCR engine is loaded at runtime; make sure all of it ships
node "$ROOT/scripts/copy-runtime-deps.js" "$OUT_APP" tesseract.js tesseract.js-core

# 1b. Built-in offline AI (llama.cpp + model) and the OCR language model
FETCH_AI="${QUIZY_BUNDLE_AI:-1}" bash "$ROOT/scripts/fetch-ai.sh" "$STAGE/ai" "$OUT_APP/ocr"

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
- llama.cpp (built-in AI engine): MIT License — https://github.com/ggml-org/llama.cpp
- Qwen3-4B-Instruct-2507 (built-in AI model): Apache License 2.0 — https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507
  (GGUF quantization by Unsloth — https://huggingface.co/unsloth)
- tesseract.js / Tesseract OCR + tessdata_fast English model: Apache License 2.0 — https://github.com/naptha/tesseract.js
EOF

# 6. Electron entry: launcher + preload + builder config + license
cp "$ROOT/scripts/launcher.js" "$INST/index.js"
cp "$ROOT/scripts/preload.js" "$INST/preload.js"

VERSION=$(cd "$INST" && node -p "require('./package.json').version")
OUT="$INST/installer-out"
rm -rf "$OUT"
mkdir -p "$ROOT/installer-out"

echo "==> Installing electron-builder + updater (first run downloads ~100MB)"
(cd "$INST" && npm i --no-audit --no-fund 2>&1 | tail -1)

build() { # $1 = artifact suffix ("" or "-lite"), $2 = targets
  (cd "$INST" && npx electron-builder --win $2 --x64 --publish never \
      -c.nsis.artifactName="Quizy-Setup-\${version}$1.\${ext}" \
      -c.portable.artifactName="Quizy-\${version}$1-portable.\${ext}" 2>&1 | tail -25)
}

# --- Lite installer: engine + OCR, AI model downloads on first launch. Used for auto-updates.
HOLD="$INST/model-hold"
mkdir -p "$HOLD"
mv "$STAGE"/ai/*.gguf "$HOLD"/ 2>/dev/null || true
echo "==> Building lite installer (AI model downloads on first launch)"
build "-lite" "nsis portable"
cp "$OUT/Quizy-Setup-$VERSION-lite.exe" "$OUT/Quizy-Setup-$VERSION-lite.exe.blockmap" "$OUT/latest.yml" "$ROOT/installer-out/"
cp "$OUT/Quizy-$VERSION-lite-portable.exe" "$ROOT/installer-out/" 2>/dev/null || true

# --- Full installer: everything bundled, works offline from the first launch.
if ls "$HOLD"/*.gguf >/dev/null 2>&1; then
  mv "$HOLD"/*.gguf "$STAGE/ai/"
  # NSIS installers can't exceed 2 GiB of compressed data. The model barely
  # compresses; the app compresses to roughly 45%. Skip if it can't fit.
  AI_BYTES=$(du -sb "$STAGE/ai" | cut -f1)
  ALL_BYTES=$(du -sb "$STAGE" | cut -f1)
  EST=$(( AI_BYTES + (ALL_BYTES - AI_BYTES) * 45 / 100 ))
  echo "==> Estimated full installer size: $((EST / 1000000)) MB (NSIS limit ~2147 MB)"
  if [ "$EST" -gt 2120000000 ]; then
    echo "!! Full installer would be too large for NSIS — skipping it. Use a smaller model, e.g."
    echo "   MODEL_FILE=Qwen3-4B-Instruct-2507-UD-IQ3_XXS.gguf bash scripts/build-installer.sh"
  else
    echo "==> Building full installer (AI included)"
    rm -f "$OUT/latest.yml"
    build "" "nsis"
    cp "$OUT/Quizy-Setup-$VERSION.exe" "$ROOT/installer-out/"
  fi
fi
rmdir "$HOLD" 2>/dev/null || true

echo ""
ls -la "$ROOT"/installer-out/ 2>/dev/null
echo ""
echo "To publish this version for automatic updates: bash scripts/publish-release.sh"
