CREATE TYPE "PlanChangeType" AS ENUM ('ACTIVATE', 'RENEW', 'UPGRADE', 'DOWNGRADE');
CREATE TYPE "PlanSource" AS ENUM ('TRIAL', 'ADMIN', 'PAYMENT');

ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';

ALTER TABLE "User"
  ADD COLUMN "planSource" "PlanSource" NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN "scheduledPlan" "Plan",
  ADD COLUMN "scheduledPlanAt" TIMESTAMP(3),
  ADD COLUMN "scheduledPlanExpiresAt" TIMESTAMP(3);

ALTER TABLE "Payment"
  ADD COLUMN "changeType" "PlanChangeType" NOT NULL DEFAULT 'ACTIVATE',
  ADD COLUMN "previousPlan" "Plan",
  ADD COLUMN "entitlementEndsAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "expiredAt" TIMESTAMP(3);

CREATE INDEX "Payment_userId_status_expiresAt_idx"
  ON "Payment"("userId", "status", "expiresAt");

-- Историю платёжных операций считаем более надёжным источником, чем старое
-- поле тарифа. Остальной активный доступ был выдан администратором.
UPDATE "User" AS u
SET "planSource" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "Payment" AS p
    WHERE p."userId" = u."id" AND p."status" = 'CONFIRMED'
  ) THEN 'PAYMENT'::"PlanSource"
  WHEN u."plan" <> 'TRIAL' THEN 'ADMIN'::"PlanSource"
  ELSE 'TRIAL'::"PlanSource"
END;

-- Уже созданные ссылки Точки живут семь дней; фиксируем тот же срок в БД,
-- чтобы старые ожидающие операции тоже перестали блокировать интерфейс.
UPDATE "Payment"
SET "expiresAt" = "createdAt" + INTERVAL '7 days'
WHERE "status" = 'PENDING' AND "expiresAt" IS NULL;
