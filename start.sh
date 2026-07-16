#!/bin/sh
# Точка входа контейнера Smailee (Amvera).
#
# В одном контейнере поднимаются ДВА процесса:
#   1. Next.js (лендинг и кабинет) — слушает PORT
#   2. worker (dist/worker.js) — отправка, IMAP-приём, ИИ-диалог, прогрев,
#      здоровье флота. БЕЗ него продукт мёртв: сайт открывается, но письма
#      не уходят и ответы не принимаются.
#
# Amvera не поддерживает docker-compose (один Dockerfile = один контейнер),
# поэтому оба процесса живут здесь. Если ЛЮБОЙ умирает — выходим с ошибкой,
# и Amvera перезапускает контейнер целиком. Работать «наполовину» (сайт жив,
# воркер мёртв) — худший исход: кабинет выглядит рабочим, а рассылка стоит.

echo "=========================================="
echo "[startup] prisma migrate deploy..."
echo "=========================================="
# migrate deploy применяет ТОЛЬКО новые миграции и никогда не удаляет данные
# (в отличие от db push --accept-data-loss). Если миграция не применилась —
# не поднимаем приложение: работать на схеме, которой не ждёт код, опаснее,
# чем честно упасть и показать ошибку в логе Amvera.
if node node_modules/prisma/build/index.js migrate deploy; then
  echo "[startup] OK: миграции применены"
else
  echo "[startup] FATAL: prisma migrate deploy упал — контейнер не стартует."
  echo "[startup] Проверь DATABASE_URL и лог выше. Данные НЕ тронуты."
  exit 1
fi

echo "[startup] запускаю Next.js на порту ${PORT:-3000}..."
node server.js &
WEB_PID=$!

echo "[startup] запускаю worker..."
node dist/worker.js &
WORKER_PID=$!

# корректная остановка контейнера — гасим оба процесса
trap 'echo "[startup] остановка..."; kill $WEB_PID $WORKER_PID 2>/dev/null; exit 0' TERM INT

echo "[startup] оба процесса запущены (web=$WEB_PID worker=$WORKER_PID)"

# busybox sh (alpine) не умеет `wait -n`, поэтому следим сами:
# падение любого процесса => выход с ошибкой => Amvera перезапустит контейнер
while true; do
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "[startup] FATAL: Next.js упал — перезапуск контейнера"
    kill $WORKER_PID 2>/dev/null
    exit 1
  fi
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "[startup] FATAL: worker упал — перезапуск контейнера"
    kill $WEB_PID 2>/dev/null
    exit 1
  fi
  sleep 5
done
