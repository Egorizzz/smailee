# Smailee — Dockerfile для прода (Amvera)
# Multi-stage: сборка → компактный runtime на основе standalone-сборки Next.js

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
# prisma generate + next build (standalone)
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
# Prisma: схема + CLI + клиент + движок (нужно для `db push` на старте)
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

# применяем схему к БД (не фатально) и запускаем сервер
CMD ["sh", "./start.sh"]
