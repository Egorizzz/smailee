-- CreateTable
CREATE TABLE "FollowupStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "daysAfterPrevious" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "FollowupStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowupStep_campaignId_stepNumber_key" ON "FollowupStep"("campaignId", "stepNumber");

-- AddForeignKey
ALTER TABLE "FollowupStep" ADD CONSTRAINT "FollowupStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: кампании, созданные до появления FollowupStep, хранили
-- follow-up одним шагом прямо в Campaign (followupDays/Subject/Body). Чтобы
-- их поведение не изменилось молча после деплоя (processFollowups теперь
-- читает только FollowupStep), для каждой такой кампании заводим один шаг,
-- эквивалентный старому. "Re: " + subject — тот же дефолт, что раньше
-- подставлял код при пустом followupSubject (см. историю sendEngine.ts).
INSERT INTO "FollowupStep" ("id", "campaignId", "stepNumber", "daysAfterPrevious", "subject", "body")
SELECT
  'legacy_' || "id",
  "id",
  1,
  "followupDays",
  COALESCE(NULLIF("followupSubject", ''), 'Re: ' || "subject"),
  COALESCE(NULLIF("followupBody", ''), 'Здравствуйте! Хотел уточнить, актуально ли ещё моё предложение?')
FROM "Campaign"
WHERE "followupEnabled" = true;
