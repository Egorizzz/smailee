-- AlterTable
ALTER TABLE "User" ADD COLUMN     "customHandoffPrompt" TEXT,
ALTER COLUMN "crmHandoffTriggers" SET DEFAULT ARRAY['call_request', 'meeting_request', 'ready_to_start', 'decision_maker']::TEXT[];

-- DataMigration: колонка была добавлена предыдущей миграцией БЕЗ default и
-- БЕЗ NOT NULL — на существующих строках она NULL, хотя Prisma-схема
-- обещает string[] (не nullable). Без бэкфилла первое же обращение
-- .crmHandoffTriggers.includes(...) у любого аккаунта, заведённого до этой
-- миграции, упало бы на null. Заодно убираем pricing_request из уже
-- сохранённых значений (эта фича ещё нигде не задеплоена, но на случай,
-- если кто-то успел настроить локально) — "просит цену" сам по себе не
-- значит "лид готов".
UPDATE "User"
SET "crmHandoffTriggers" = ARRAY['call_request', 'meeting_request', 'ready_to_start', 'decision_maker']::TEXT[]
WHERE "crmHandoffTriggers" IS NULL;

UPDATE "User"
SET "crmHandoffTriggers" = array_remove("crmHandoffTriggers", 'pricing_request')
WHERE 'pricing_request' = ANY("crmHandoffTriggers");

ALTER TABLE "User" ALTER COLUMN "crmHandoffTriggers" SET NOT NULL;
