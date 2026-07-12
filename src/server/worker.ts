/**
 * Standalone worker для прода (Amvera). Локально: `npm run worker`.
 *
 * Периодически:
 *  - запускает отложенные кампании, когда наступает scheduledAt;
 *  - добирает кампании с невыполненными письмами (QUEUED/SENDING) через пул
 *    ящиков клиента (§5.3, M2);
 *  - создаёт follow-up письма для кампаний без ответа;
 *  - опрашивает IMAP подключённых ящиков за новыми ответами (§5.4, M3) — throttle
 *    на ящик внутри pollInboundMailboxes, поэтому тик воркера может быть чаще.
 *
 * Локально отправка также инициируется синхронно при запуске кампании
 * (см. launchCampaign в campaigns/actions.ts), поэтому worker не обязателен
 * для мгновенной обратной связи — но нужен, чтобы добивать очередь по мере
 * освобождения дневных лимитов ящиков/доменов на следующий день, и обязателен
 * для приёма ответов (IMAP-поллинг работает только здесь).
 */
import { prisma } from "@/lib/prisma";
import { processCampaign, processFollowups } from "./sendEngine";
import { pollInboundMailboxes } from "./inboundEngine";
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

  // IMAP-поллинг ящиков за новыми ответами (throttle на ящик — внутри)
  const inbound = await pollInboundMailboxes();
  if (inbound.checked || inbound.matched) {
    console.log(
      `[worker] inbound: checked=${inbound.checked} newEmails=${inbound.newEmails} matched=${inbound.matched} warmup=${inbound.warmup}`
    );
  }
}

async function main() {
  console.log("[worker] Smailee worker запущен (M2: пул ящиков; M3: IMAP-приём + AI-диалог)");
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
