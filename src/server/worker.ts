/**
 * Standalone worker для прода (Amvera). Локально: `npm run worker`.
 *
 * Периодически:
 *  - запускает отложенные кампании, когда наступает scheduledAt;
 *  - добирает кампании с невыполненными письмами (QUEUED/SENDING) через пул
 *    ящиков клиента (§5.3, M2);
 *  - создаёт follow-up письма для кампаний без ответа.
 *
 * Локально отправка также инициируется синхронно при запуске кампании
 * (см. launchCampaign в campaigns/actions.ts), поэтому worker не обязателен
 * для мгновенной обратной связи — но нужен, чтобы добивать очередь по мере
 * освобождения дневных лимитов ящиков/доменов на следующий день.
 */
import { prisma } from "@/lib/prisma";
import { processCampaign, processFollowups } from "./sendEngine";
import { config } from "@/lib/config";

const POLL_MS = config.workerPollMs;

async function tick() {
  // отложенные кампании, чей срок настал → в очередь
  await prisma.campaign.updateMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    data: { status: "QUEUED" },
  });

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
}

async function main() {
  console.log("[worker] Smailee worker запущен (M2: пул ящиков, лимиты 30/120)");
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
