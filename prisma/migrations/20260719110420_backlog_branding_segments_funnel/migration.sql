-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "EmailTemplate" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "brandFont" TEXT,
ADD COLUMN     "brandSignature" TEXT,
ADD COLUMN     "funnelPrompt" TEXT;

-- CreateTable
CREATE TABLE "ImageGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageGeneration_userId_createdAt_idx" ON "ImageGeneration"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_userId_batchId_idx" ON "Campaign"("userId", "batchId");

-- AddForeignKey
ALTER TABLE "ImageGeneration" ADD CONSTRAINT "ImageGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
