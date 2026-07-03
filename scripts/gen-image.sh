#!/usr/bin/env bash
# Smailee — генерация одной иллюстрации через fal.ai (Recraft v3)
# Recraft v3 даёт чёткие flat/vector иллюстрации (в отличие от размытого FLUX).
# Использование: ./scripts/gen-image.sh "<prompt>" <output_filename.webp> [aspect]
# aspect: square | landscape_16_9 | portrait_4_3 (по умолчанию square)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a

PROMPT="${1:?нужен промпт}"
OUT="${2:?нужно имя файла}"
ASPECT="${3:-square}"

case "$ASPECT" in
  landscape_16_9) IMGSIZE='"landscape_16_9"' ;;
  portrait_4_3)   IMGSIZE='"portrait_4_3"' ;;
  square)         IMGSIZE='"square_hd"' ;;
  *)              IMGSIZE="\"$ASPECT\"" ;;
esac

mkdir -p "$ROOT/public/generated"

# Единый бренд-стиль дописывается к каждому промпту
STYLE_SUFFIX=", flat friendly illustration, mint green and indigo purple palette, white background, simple clean shapes"

RESP=$(curl -s -X POST "https://fal.run/fal-ai/recraft/v3/text-to-image" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1] + sys.argv[2]))" "$PROMPT" "$STYLE_SUFFIX"), \"image_size\": $IMGSIZE, \"style\": \"digital_illustration\"}")

URL=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['images'][0]['url'])" 2>/dev/null || true)

if [ -z "$URL" ]; then
  echo "ОШИБКА генерации: $RESP"
  exit 1
fi

# Скачиваем с ретраями (CDN fal.media иногда рвёт соединение)
for attempt in 1 2 3 4 5; do
  curl -sL --retry 3 --max-time 60 "$URL" -o "$ROOT/public/generated/$OUT" && \
  if [ -s "$ROOT/public/generated/$OUT" ]; then
    echo "OK -> public/generated/$OUT ($(stat -f%z "$ROOT/public/generated/$OUT") bytes)"
    exit 0
  fi
  echo "  попытка $attempt не удалась, повтор..."
  sleep 2
done

echo "ОШИБКА: не удалось скачать после 5 попыток. URL: $URL"
exit 1
