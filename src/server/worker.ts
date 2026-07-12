/**
 * Standalone worker для прода (Amvera). Локально: `npm run worker`.
 *
 * M1 (фундамент модели C): оркестрации отправки/приёма/прогрева ещё нет —
 * они появятся в M2 (оркестрация пула ящиков), M3 (IMAP-поллинг), M4 (прогрев).
 * Пока воркер только помечает наступившие отложенные кампании как QUEUED, чтобы
 * очередь была готова к движку отправки M2.
 */
import { prisma } from "@/lib/prisma";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);

async function tick() {
  // отложенные кампании, чей срок настал → в очередь (реальную отправку добавит M2)
  await prisma.campaign.updateMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    data: { status: "QUEUED" },
  });
}

async function main() {
  console.log("[worker] Smailee worker запущен (M1: только постановка в очередь)");
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
