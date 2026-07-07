/**
 * Standalone worker для прода (Amvera).
 *
 * Периодически:
 *  - добирает кампании с невыполненными письмами (QUEUED/SENDING/SCHEDULED) и досылает;
 *  - запускает отложенные кампании, когда наступает scheduledAt;
 *  - создаёт follow-up письма для кампаний без ответа.
 *
 * Локально: `npm run worker`. В dev отправка также инициируется синхронно при
 * запуске кампании, поэтому worker не обязателен.
 */
import { prisma } from "@/lib/prisma";
import { processCampaign, processFollowups } from "./sendEngine";
import { materializeDueSteps, processHighEngagementContacts } from "./contentCampaign";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);

async function tick() {
  // запуск отложенных кампаний
  await prisma.campaign.updateMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    data: { status: "QUEUED" },
  });

  // контент-серии: материализовать письма шагов, чей срок настал
  const materialized = await materializeDueSteps();
  if (materialized) console.log(`[worker] series: materialized ${materialized} messages`);

  const campaigns = await prisma.campaign.findMany({
    where: { status: { in: ["QUEUED", "SENDING"] } },
    select: { id: true },
    take: 5,
  });
  for (const c of campaigns) {
    const res = await processCampaign(c.id);
    if (res.sent || res.failed || res.skipped) {
      console.log(
        `[worker] campaign ${c.id}: sent=${res.sent} failed=${res.failed} skipped=${res.skipped} remaining=${res.remaining}`
      );
    }
  }

  // follow-up для отправленных кампаний
  const sentCampaigns = await prisma.campaign.findMany({
    where: { followupEnabled: true, status: { in: ["SENT", "SENDING"] } },
    select: { id: true },
    take: 10,
  });
  for (const c of sentCampaigns) {
    const n = await processFollowups(c.id);
    if (n) console.log(`[worker] campaign ${c.id}: created ${n} follow-ups`);
  }

  // контент-серии: авто-касание контактов с высоким open rate
  const nudged = await processHighEngagementContacts();
  if (nudged) console.log(`[worker] series: sent ${nudged} personal nudges`);
}

async function main() {
  console.log("[worker] Smailee send worker запущен");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (e) {
      console.error("[worker] error:", e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
