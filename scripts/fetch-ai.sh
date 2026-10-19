#!/usr/bin/env bash
# Download the built-in offline AI + OCR assets into a target folder.
#   bash scripts/fetch-ai.sh <ai-dir> <ocr-dir>
# - llama.cpp's llama-server for Windows (MIT)        → <ai-dir>/llama-server.exe + DLLs
# - Qwen3-4B-Instruct-2507 GGUF model (Apache-2.0)    → <ai-dir>/<model>.gguf
# - Tesseract English model (tessdata_fast, Apache-2.0) → <ocr-dir>/eng.traineddata
# Downloads are cached in installer/cache so rebuilds don't re-download ~2 GB.
#
# Overrides (env):
#   LLAMA_CPP_TAG=b11669       llama.cpp release to use (default b11669; empty = newest with a Windows build)
#   LLAMA_CPP_VARIANT=vulkan   vulkan (GPU when available, falls back to CPU) | cpu
#   MODEL_REPO / MODEL_FILE    Hugging Face repo + file of the GGUF to bundle
#   FETCH_AI=0                 only fetch the OCR model (no built-in AI)
set -euo pipefail

AI_DIR="${1:?usage: fetch-ai.sh <ai-dir> <ocr-dir>}"
OCR_DIR="${2:?usage: fetch-ai.sh <ai-dir> <ocr-dir>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/installer/cache"
mkdir -p "$CACHE" "$AI_DIR" "$OCR_DIR"

MODEL_REPO="${MODEL_REPO:-unsloth/Qwen3-4B-Instruct-2507-GGUF}"
MODEL_FILE="${MODEL_FILE:-Qwen3-4B-Instruct-2507-Q3_K_S.gguf}"
VARIANT="${LLAMA_CPP_VARIANT:-vulkan}"

dl() { # url dest
  if [ -s "$2" ]; then echo "    (cached) $(basename "$2")"; return; fi
  echo "    downloading $(basename "$2")…"
  curl -fL --retry 3 --progress-bar -o "$2.part" "$1"
  mv "$2.part" "$2"
}

if [ "${FETCH_AI:-1}" != "0" ]; then
echo "==> llama.cpp server ($VARIANT)"
# Default: a known-good build. llama.cpp's "latest" release can be a source-only
# semver release, so when unpinned we scan recent releases for a Windows build.
LLAMA_CPP_TAG="${LLAMA_CPP_TAG-b11669}"
if [ -n "$LLAMA_CPP_TAG" ]; then
  API="https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/$LLAMA_CPP_TAG"
else
  API="https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30"
fi
ZIP_URL="$(curl -fsSL "$API" | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const data = JSON.parse(s);
    const rels = Array.isArray(data) ? data : [data];
    const want = new RegExp("bin-win-" + process.argv[1] + "-x64\\.zip$");
    for (const rel of rels) {
      const a = (rel.assets || []).find(x => want.test(x.name));
      if (a) { console.log(a.browser_download_url); return; }
    }
    console.error("No Windows " + process.argv[1] + " build found in " + rels.map(r => r.tag_name).join(", "));
    process.exit(1);
  });' "$VARIANT")"
ZIP="$CACHE/$(basename "$ZIP_URL")"
dl "$ZIP_URL" "$ZIP"
rm -f "$AI_DIR"/*.exe "$AI_DIR"/*.dll
TMPX="$(mktemp -d)"
unzip -q -o "$ZIP" -d "$TMPX"
SERVER="$(find "$TMPX" -name 'llama-server.exe' | head -1)"
[ -n "$SERVER" ] || { echo "llama-server.exe not found in $ZIP"; exit 1; }
SRC_DIR="$(dirname "$SERVER")"
cp "$SERVER" "$AI_DIR/"
cp "$SRC_DIR"/*.dll "$AI_DIR/" 2>/dev/null || true
[ -f "$SRC_DIR/LICENSE" ] && cp "$SRC_DIR/LICENSE" "$AI_DIR/LICENSE-llama.cpp.txt" || true
rm -rf "$TMPX"

echo "==> Model $MODEL_FILE"
dl "https://huggingface.co/$MODEL_REPO/resolve/main/$MODEL_FILE" "$CACHE/$MODEL_FILE"
rm -f "$AI_DIR"/*.gguf
cp "$CACHE/$MODEL_FILE" "$AI_DIR/$MODEL_FILE"
SIZE=$(wc -c < "$AI_DIR/$MODEL_FILE")
[ "$SIZE" -gt 500000000 ] || { echo "Model download looks wrong ($SIZE bytes)"; exit 1; }
fi

echo "==> OCR model (English)"
dl "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata" "$CACHE/eng.traineddata"
cp "$CACHE/eng.traineddata" "$OCR_DIR/eng.traineddata"

echo "    AI folder: $(du -sh "$AI_DIR" | cut -f1)"
