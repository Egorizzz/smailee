# Замороженная фича: Контент-маркетинг (серии писем)

**Статус:** заморожена при переходе на модель C (cold outreach на пуле ящиков),
см. `docs/tz/cold-outreach-mailbox-model.md` §7 (v1.1).

**Почему заморожена, а не удалена:** фича рабочая, но завязана на удалённый
Unisender-стек отправки и на модель «контент-маркетинг», которой нет в ядре
cold-outreach. Код сохранён здесь целиком для возможного оживления.

**Важно:** эта папка исключена из компиляции (`tsconfig.json` → `exclude: ["frozen"]`).
Файлы здесь НЕ компилируются и НЕ импортируются живым кодом. Их внутренние импорты
(`@/lib/services/llm` серия-функции, `sendEngine`, prisma-модели `ContentStep` и т.п.)
указывают на сущности, которые были удалены из живого кода — это ожидаемо.

## Что внутри
- `content-marketing/server/contentCampaign.ts` — оркестрация серий (план → генерация → материализация → авто-касание).
- `content-marketing/lib/falai.ts` — адаптер fal.ai (генерация картинок).
- `content-marketing/lib/contentEmailTemplate.ts` — HTML-рендер письма серии.
- `content-marketing/lib/llm-series-functions.ts.txt` — извлечённые серия-функции LLM (были в `deepseek.ts`/`claude.ts` + обёртки в `llm.ts`).
- `content-marketing/app/series/**` — UI создания/управления серией.
- `content-marketing/app/cta-thanks/**`, `content-marketing/api/cta/**` — CTA-лид из письма серии.
- `content-marketing/schema-fragment.prisma` — фрагмент схемы, который был в `prisma/schema.prisma`.

## Как оживить (когда/если понадобится)
1. Вернуть модели из `schema-fragment.prisma` в `prisma/schema.prisma`
   (`ContentStep`, `CampaignType`, `ContentStepStatus`, поля `Campaign.type/seriesTopic/…`,
   `Message.contentStepId/isPersonalNudge`, `ImageGeneration`), `npx prisma db push`.
2. Вернуть серия-функции из `llm-series-functions.ts.txt` в `deepseek.ts`/`claude.ts`
   и обёртки в `llm.ts`.
3. Перенести файлы обратно в `src/` (server/lib/app/api), поправить импорты.
4. **Переключить отправку** с удалённого Unisender на новый транспорт модели C
   (SMTP пула ящиков, M2) — старый `sendEngine`/`sendEmail` больше не существуют.
5. Вернуть `FAL_KEY`/`FAL_IMAGE_BUDGET` в env, если нужны реальные картинки.
6. Вернуть маршрут в UI (кнопка «Серия контент-маркетинга» в `campaigns/page.tsx`).
