/**
 * Standalone worker для прода (Amvera).
 * Периодически добирает кампании с невыполненными письмами и досылает их.
 * Локально можно запускать: `npm run worker`.
 *
 * На проде запускается как отдельный процесс рядом с Next-приложением
 * (см. README / Dockerfile). В dev-режиме отправка также инициируется
 * синхронно при запуске кампании, поэтому worker не обязателен.
 */
import { prisma } from "@/lib/prisma";
import { processCampaign } from "./sendEngine";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);

async function tick() {
  const campaigns = await prisma.campaign.findMany({
    where: { status: { in: ["QUEUED", "SENDING"] } },
    select: { id: true },
    take: 5,
  });
  for (const c of campaigns) {
    const res = await processCampaign(c.id);
    if (res.sent || res.failed) {
      console.log(
        `[worker] campaign ${c.id}: sent=${res.sent} failed=${res.failed} remaining=${res.remaining}`
      );
    }
  }
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
