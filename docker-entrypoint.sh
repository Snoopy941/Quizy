#!/bin/sh
set -e

echo "[quizy] applying database migrations…"
npx prisma migrate deploy

echo "[quizy] starting server on port ${PORT:-4000}…"
exec node server.js
