CREATE TYPE "PlanNotificationKind" AS ENUM (
  'DEMO_ENDS_3D',
  'DEMO_ENDS_1D',
  'PLAN_DISABLED',
  'RETURN_3D',
  'RETURN_10D',
  'RETURN_30D'
);

CREATE TABLE "PlanNotification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "PlanNotificationKind" NOT NULL,
  "cycleKey" TEXT NOT NULL,
  "plan" "Plan" NOT NULL,
  "wasDemo" BOOLEAN NOT NULL DEFAULT false,
  "planEndsAt" TIMESTAMP(3) NOT NULL,
  "requiresExpiryMatch" BOOLEAN NOT NULL DEFAULT true,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlanNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanNotification_userId_cycleKey_kind_key"
  ON "PlanNotification"("userId", "cycleKey", "kind");
CREATE INDEX "PlanNotification_sentAt_canceledAt_nextAttemptAt_idx"
  ON "PlanNotification"("sentAt", "canceledAt", "nextAttemptAt");
CREATE INDEX "PlanNotification_userId_planEndsAt_idx"
  ON "PlanNotification"("userId", "planEndsAt");

ALTER TABLE "PlanNotification"
  ADD CONSTRAINT "PlanNotification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
