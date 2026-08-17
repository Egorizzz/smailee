ALTER TABLE "WebsiteCrawl"
  ADD COLUMN "profileData" JSONB,
  ADD COLUMN "profileQuestions" JSONB,
  ADD COLUMN "profileVersion" INTEGER,
  ADD COLUMN "synthesizedAt" TIMESTAMP(3);

-- Для текущего черновика можем восстановить последнюю AI-версию без повторного
-- обращения к провайдерам. Более старые обходы всё равно сохраняют страницы и
-- постраничный анализ, поэтому их можно пересобрать кнопкой в кабинете.
UPDATE "WebsiteCrawl" AS crawl
SET
  "profileData" = profile."draftData",
  "profileQuestions" = '[]'::jsonb,
  "synthesizedAt" = crawl."updatedAt"
FROM "OrganizationProfile" AS profile
WHERE profile."sourceCrawlId" = crawl."id"
  AND profile."draftData" IS NOT NULL;

WITH numbered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId"
      ORDER BY COALESCE("synthesizedAt", "createdAt"), "createdAt", "id"
    ) AS version
  FROM "WebsiteCrawl"
  WHERE "profileData" IS NOT NULL
)
UPDATE "WebsiteCrawl" AS crawl
SET "profileVersion" = numbered.version
FROM numbered
WHERE crawl."id" = numbered."id";

CREATE UNIQUE INDEX "WebsiteCrawl_organizationId_profileVersion_key"
  ON "WebsiteCrawl"("organizationId", "profileVersion");
