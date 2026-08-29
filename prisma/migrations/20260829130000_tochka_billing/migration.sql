-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('ONE_TIME', 'SUBSCRIPTION_INITIAL', 'SUBSCRIPTION_RENEWAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "BillingSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'CHARGING', 'PAST_DUE', 'CANCELLED', 'FAILED');

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "kind" "PaymentKind" NOT NULL DEFAULT 'ONE_TIME',
ADD COLUMN "subscriptionId" TEXT,
ADD COLUMN "paymentLink" TEXT,
ADD COLUMN "failureCode" TEXT,
ADD COLUMN "failedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'tochka',
    "providerSubscriptionId" TEXT,
    "plan" "Plan" NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "BillingSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "consentAt" TIMESTAMP(3) NOT NULL,
    "offerVersion" TEXT,
    "activatedAt" TIMESTAMP(3),
    "nextChargeAt" TIMESTAMP(3),
    "chargeStartedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "providerCancelledAt" TIMESTAMP(3),
    "lastFailureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_providerSubscriptionId_key" ON "BillingSubscription"("providerSubscriptionId");
CREATE INDEX "BillingSubscription_userId_status_idx" ON "BillingSubscription"("userId", "status");
CREATE INDEX "BillingSubscription_status_nextChargeAt_idx" ON "BillingSubscription"("status", "nextChargeAt");
CREATE INDEX "Payment_subscriptionId_status_idx" ON "Payment"("subscriptionId", "status");

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "BillingSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
