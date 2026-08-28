/** Scoped worker for contact prospecting only. Safe for local API tests. */
import { prisma } from "@/lib/prisma";
import { processQueuedProspectingRuns } from "@/lib/company-data/prospectingRuns";
import { config } from "@/lib/config";

const once = process.argv.includes("--once");
let stopping = false;

async function stop() {
  stopping = true;
  await prisma.$disconnect();
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

async function main() {
  console.log("[prospecting-worker] Запущен обработчик подбора контактов");
  do {
    const runs = await processQueuedProspectingRuns(prisma, 1);
    if (runs.length) {
      console.log(`[prospecting-worker] ${runs.map((run) => `${run.id}=${run.status}`).join(", ")}`);
    }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, config.workerPollMs));
  } while (!stopping);
}

main()
  .catch((error) => {
    console.error("[prospecting-worker] Не удалось обработать очередь", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
