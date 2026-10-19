# ---- deps ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci || npm install

# ---- build ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Canonical public URL baked into the client bundle at build time
ARG NEXT_PUBLIC_SITE_URL=https://quizy.study
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
# Dummy DATABASE_URL for prisma generate during image build
ENV DATABASE_URL="file:./data/quizy.db"
RUN npx prisma generate && npx next build

# ---- runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S quizy && adduser -S quizy -G quizy
RUN mkdir -p /app/data/uploads && chown -R quizy:quizy /app/data

COPY --from=builder /app/public ./public
COPY --from=builder --chown=quizy:quizy /app/.next/standalone ./
COPY --from=builder --chown=quizy:quizy /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
# OCR engine (loaded at runtime, so standalone tracing may miss parts of it)
COPY --from=builder /app/node_modules/tesseract.js ./node_modules/tesseract.js
COPY --from=builder /app/node_modules/tesseract.js-core ./node_modules/tesseract.js-core
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && chown -R quizy:quizy /app

USER quizy
EXPOSE 4000
ENTRYPOINT ["./docker-entrypoint.sh"]
