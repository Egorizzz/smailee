# Smailee — Dockerfile для прода (Amvera)
# Multi-stage: сборка → компактный runtime (standalone-сборка Next.js + бандл воркера)
#
# ВАЖНО (Amvera): переменные окружения НЕДОСТУПНЫ на этапе сборки — они
# приходят только в рантайме. Поэтому здесь нет и не должно быть ничего,
# что требует DATABASE_URL и прочих секретов во время build.

# ---- deps (полные, включая devDependencies — нужны для сборки) ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- prod-deps (только рантайм-зависимости — то, что реально едет в runner) ----
# `prisma` (CLI) — в dependencies (не dev): он реально выполняется в рантайме
# (`migrate deploy` в start.sh), поэтому его полное дерево транзитивных
# зависимостей (включая непрямые, вне node_modules/@prisma и node_modules/.prisma
# — напр. пакет `effect`, от которого зависит @prisma/config) обязано попасть
# сюда. `npm ci --omit=dev` даёт это гарантированно, без ручного перечисления
# отдельных папок node_modules, которое ломается при любом апдейте Prisma.
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

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

# Prisma: схема + МИГРАЦИИ + prod-only node_modules (нужно для `migrate
# deploy` на старте). Раньше копировались только .prisma/@prisma/prisma —
# ломалось при апдейте Prisma: CLI тянет транзитивные зависимости ВНЕ этих
# папок (напр. пакет `effect`, от которого зависит @prisma/config), а
# standalone-трейсинг Next.js их не подхватывает (код приложения импортирует
# только @prisma/client, не сам CLI) → MODULE_NOT_FOUND на старте контейнера,
# которое не видно ни при обычной сборке, ни при `npm run db:migration-check`
# (оба гоняются на ПОЛНОМ дев-node_modules, а не на обрезанном рантайм-образе).
# prod-deps (npm ci --omit=dev) даёт весь прод-граф зависимостей без
# перечисления отдельных папок вручную.
COPY --from=builder /app/prisma ./prisma
COPY --from=prod-deps /app/node_modules ./node_modules

# точка входа
COPY --from=builder /app/start.sh ./start.sh
RUN chmod +x ./start.sh

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# миграции + Next.js + worker (см. start.sh)
CMD ["sh", "./start.sh"]
