CREATE TYPE "PlanActivationMode" AS ENUM ('IMMEDIATE', 'NEXT_PERIOD');

ALTER TABLE "Payment"
  ADD COLUMN "activationMode" "PlanActivationMode";

ALTER TABLE "User"
  ADD COLUMN "planPeriodStartedAt" TIMESTAMP(3);

-- Старым аккаунтам даём наиболее точную доступную границу текущего периода.
-- Новые оплаты всегда записывают её явно, поэтому предоплаченный будущий
-- период больше не влияет на текущие квоты.
UPDATE "User" AS u
SET "planPeriodStartedAt" = COALESCE(
  (
    SELECT MAX(p."confirmedAt")
    FROM "Payment" AS p
    WHERE p."userId" = u."id"
      AND p."status" = 'CONFIRMED'
      AND p."confirmedAt" IS NOT NULL
  ),
  CASE
    WHEN u."planExpiresAt" IS NOT NULL THEN u."planExpiresAt" - INTERVAL '30 days'
    ELSE NULL
  END
)
WHERE u."plan" <> 'TRIAL';
