CREATE TYPE "OutreachChannel" AS ENUM ('EMAIL', 'TELEGRAM');

ALTER TABLE "Campaign"
  ADD COLUMN "channel" "OutreachChannel" NOT NULL DEFAULT 'EMAIL';

CREATE INDEX "Campaign_channel_isDemo_status_idx"
  ON "Campaign"("channel", "isDemo", "status");
