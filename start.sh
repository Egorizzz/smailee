#!/bin/sh
# Точка входа контейнера Smailee.
#
# ВАЖНО: применение схемы НЕ должно ронять сервер. Если prisma db push падает —
# логируем и всё равно поднимаем Next на предыдущей схеме. Плохой деплой =
# «сайт не обновился», а не «сайт лежит».

echo "=========================================="
echo "[startup] prisma db push..."
echo "=========================================="
if node node_modules/prisma/build/index.js db push --skip-generate; then
  echo "[startup] OK: schema in sync"
else
  echo "[startup] WARN: prisma db push failed — starting server on previous schema"
fi

echo "[startup] starting Next.js (standalone) on port ${PORT:-3000}..."
exec node server.js
