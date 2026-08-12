ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'BASIC' BEFORE 'START';

ALTER TABLE "User"
ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- Старые кабинеты с demoUsedAt могли получить START вручную без платежа.
-- Демо-флаг ставим только сроку, похожему на исходные 14 дней демо.
UPDATE "User" AS u
SET "isDemo" = true
WHERE u."demoUsedAt" IS NOT NULL
  AND u."plan" = 'START'
  AND u."planExpiresAt" IS NOT NULL
  AND u."planExpiresAt" <= u."demoUsedAt" + INTERVAL '15 days'
  AND NOT EXISTS (
    SELECT 1 FROM "Payment" AS p
    WHERE p."userId" = u."id" AND p."status" = 'CONFIRMED'
  );
