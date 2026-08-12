import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { queueGlobalTechnicalAlert } from "@/server/adminNotifications";

const FAILURES_BEFORE_ALERT = 3;

/** Reports a shared dependency outage after three failures, at most daily. */
export async function reportSharedApiFailure(service: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[service-alert] ${service} unavailable:`, error);
  const incident = await prisma.systemApiIncident.upsert({
    where: { service },
    update: {
      message: message.slice(0, 1000),
      lastFailedAt: new Date(),
      resolvedAt: null,
      failureCount: { increment: 1 },
    },
    create: { service, message: message.slice(0, 1000), failureCount: 1 },
  }).catch((dbError) => {
    console.error("[service-alert] could not save incident", dbError);
    return null;
  });
  if (!incident || incident.failureCount < FAILURES_BEFORE_ALERT || !config.adminEmail) return;

  await queueGlobalTechnicalAlert({
      type: "SHARED_API_UNAVAILABLE",
      resourceKey: service,
      subject: `[Smailee] Недоступен общий API: ${service}`,
      text: `Smailee не смог обратиться к ${service} три раза подряд.\n\n${message}\n\nПовторное уведомление по этому сервису придёт не раньше чем через сутки.`,
  }).catch((queueError) => console.error("[service-alert] could not queue alert", queueError));
}

export async function reportSharedApiSuccess(service: string) {
  await prisma.systemApiIncident.updateMany({
    where: { service, OR: [{ resolvedAt: null }, { failureCount: { gt: 0 } }] },
    data: { resolvedAt: new Date(), failureCount: 0 },
  })
    .catch((dbError) => console.error("[service-alert] could not resolve incident", dbError));
}
