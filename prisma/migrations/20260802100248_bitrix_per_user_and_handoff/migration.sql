-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "crmEntityId" TEXT,
ADD COLUMN     "handedOffAt" TIMESTAMP(3),
ADD COLUMN     "handoffTrigger" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bitrixWebhookEnc" TEXT,
ADD COLUMN     "crmHandoffTriggers" TEXT[];
