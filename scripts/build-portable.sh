#!/usr/bin/env bash
# Assemble the portable Windows build: dist/Quizy/Quizy.exe
# Prereqs: Node on PATH. Run from the repo root: bash scripts/build-portable.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist/Quizy"
ELECTRON_VERSION="33.4.11"
PORT=3927

command -v node >/dev/null || { echo "node not on PATH"; exit 1; }

echo "==> Building Next.js standalone"
(cd "$ROOT" && npx next build)

echo "==> Fetching Electron runtime v$ELECTRON_VERSION"
TMP="$(mktemp -d)"
curl -sL -o "$TMP/electron.zip" \
  "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-win32-x64.zip"
mkdir -p "$TMP/electron"
unzip -q -o "$TMP/electron.zip" -d "$TMP/electron"

echo "==> Assembling $DIST"
mkdir -p "$DIST/bin" "$DIST/data/uploads" "$TMP/launcherapp"

# Preserve user data + login-keeping secret across rebuilds.
SAVED="$TMP/keep"
mkdir -p "$SAVED"
for f in data README.txt app/.quizy-secret; do
  [ -e "$DIST/$f" ] && cp -r "$DIST/$f" "$SAVED/$(basename "$f")"
done
rm -rf "$DIST"
mkdir -p "$DIST"
for f in data README.txt; do
  [ -e "$SAVED/$f" ] && cp -r "$SAVED/$f" "$DIST/$f"
done
[ -f "$SAVED/.quizy-secret" ] && cp "$SAVED/.quizy-secret" "$DIST/app/.quizy-secret"

# 1. Electron at the folder root, renamed Quizy.exe, with our launcher as its app
cp "$ROOT/scripts/launcher.js" "$TMP/launcherapp/index.js"
printf '{"name":"quizy","version":"1.0.0","main":"index.js","productName":"Quizy"}' \
  > "$TMP/launcherapp/package.json"
printf 'Quizy study app - do not edit this folder. Run Quizy.exe instead.' \
  > "$TMP/launcherapp/README.txt"
cp -r "$TMP/electron" "$DIST"
rm -rf "$DIST/resources/app" "$DIST/resources/default_app.asar"
cp -r "$TMP/launcherapp" "$DIST/resources/app"
mv "$DIST/electron.exe" "$DIST/Quizy.exe"# 2. Next.js standalone server + static assets + brand icons
 cp -r "$ROOT/.next/standalone" "$DIST/app"
 cp -r "$ROOT/public" "$DIST/app/public"
 cp "$ROOT/assets/quizy-icon.png" "$DIST/app/quizy-icon.png"
 cp "$ROOT/assets/quizy.ico" "$DIST/app/quizy.ico"
 rm -f "$DIST/app/.env"                      # launcher sets env explicitly
 mkdir -p "$DIST/app/.next"
 cp -r "$ROOT/.next/static" "$DIST/app/.next/static"

# 3. Server runtime (Node) used to run the standalone server
cp "$(command -v node | sed 's|/node$|/node.exe|; s|/node$|.exe|; s|$|.exe|')" "$DIST/bin/node.exe" 2>/dev/null \
  || cp "$(command -v node)" "$DIST/bin/node.exe"

# 4. Seed data (if the dev DB exists, carry it over; otherwise leave fresh)
if [ -f "$ROOT/prisma/data/quizy.db" ]; then
  cp "$ROOT/prisma/data/quizy.db" "$DIST/data/quizy.db"
fi
[ -f "$ROOT/data/sample.pdf" ] && cp "$ROOT/data/sample.pdf" "$DIST/data/sample.pdf" || true

# 5. Quit helper (Node single-executable app)
cat > "$TMP/quit.js" <<'EOF'
const http = require("http");
const fs = require("fs");
const path = require("path");
const dir = path.dirname(process.execPath);
let token = "";
try { token = fs.readFileSync(path.join(dir, "data", ".quit-token"), "utf8").trim(); } catch (e) {}
const req = http.request(
  { host: "127.0.0.1", port: 3927, path: "/api/quit", method: "POST", timeout: 3000, headers: { "x-quizy-quit": token } },
  (res) => { res.resume(); res.on("end", () => process.exit(0)); }
);
req.on("error", () => process.exit(0));
req.on("timeout", () => { req.destroy(); process.exit(0); });
req.end();
setTimeout(() => process.exit(0), 3500).unref();
EOF
(cd "$TMP" && printf '{"main":"quit.js","output":"sea-prep.blob","disableExperimentalSEAWarning":true}' > sea.json \
  && node --experimental-sea-config sea.json \
  && cp "$(command -v node)" quit.exe \
  && npx -y postject quit.exe NODE_SEA_BLOB sea-prep.blob \
      --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2)
cp "$TMP/quit.exe" "$DIST/Quit Quizy.exe"

# 6. Brand the exe icon (taskbar/explorer) if rcedit is installed
 if node -e "require('rcedit')" 2>/dev/null; then
   node -e "const {rcedit}=require('rcedit');rcedit(process.argv[1],{icon:process.argv[2],'version-string':{ProductName:'Quizy',FileDescription:'Quizy — AI Flashcards from Any PDF'}}).then(()=>console.log('==> Quizy.exe icon set')).catch(e=>{console.error(e.message);process.exit(1)})" \
     "$DIST/Quizy.exe" "$ROOT/assets/quizy.ico"
 else
   echo "==> (skipping exe icon: rcedit not installed — run: npm i -D rcedit)"
 fi

cp "$ROOT/dist/Quizy/README.txt" "$DIST/README.txt" 2>/dev/null || true

echo ""
echo "Done: $DIST/Quizy.exe  ($(du -sh "$DIST" | cut -f1))"
echo "Note: Quit Quizy.exe must stay inside the Quizy folder (it reads data/.quit-token)."
