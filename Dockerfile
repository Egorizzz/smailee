# Smailee — Dockerfile для прода (Amvera)
# Multi-stage: сборка → компактный runtime (standalone-сборка Next.js + бандл воркера)
#
# ВАЖНО (Amvera): переменные окружения НЕДОСТУПНЫ на этапе сборки — они
# приходят только в рантайме. Поэтому здесь нет и не должно быть ничего,
# что требует DATABASE_URL и прочих секретов во время build.

# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# prisma generate + next build (standalone) + esbuild-бандл воркера (dist/worker.js)
RUN npm run build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# standalone-сборка Next.js
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# воркер: собранный бандл (без tsx и TS-исходников)
COPY --from=builder /app/dist/worker.js ./dist/worker.js

# корпус прогрева (§5.9.3) — читается воркером с ДИСКА в рантайме
# (process.cwd()/src/lib/warmup/corpus), в бандл не инлайнится. Без этих
# файлов прогрев молча не работает.
COPY --from=builder /app/src/lib/warmup/corpus ./src/lib/warmup/corpus

# Prisma: схема + МИГРАЦИИ + CLI + клиент + движок (нужно для `migrate deploy` на старте)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# точка входа
COPY --from=builder /app/start.sh ./start.sh
RUN chmod +x ./start.sh

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# миграции + Next.js + worker (см. start.sh)
CMD ["sh", "./start.sh"]
