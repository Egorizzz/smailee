import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";

const cooldownMs = 15 * 60_000;
const lastSent = new Map<string, number>();

/** Reports a shared dependency outage once per service per process/cooldown. */
export async function reportSharedApiFailure(service: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[service-alert] ${service} unavailable:`, error);
  await prisma.systemApiIncident.upsert({
    where: { service },
    update: { message: message.slice(0, 1000), lastFailedAt: new Date(), resolvedAt: null },
    create: { service, message: message.slice(0, 1000) },
  }).catch((dbError) => console.error("[service-alert] could not save incident", dbError));
  const to = config.adminEmail;
  const now = Date.now();
  if (!to || now - (lastSent.get(service) ?? 0) < cooldownMs) return;
  lastSent.set(service, now);
  try {
    const { sendSystemMail } = await import("@/lib/systemMail");
    await sendSystemMail({
      to,
      subject: `[Smailee] Недоступен общий API: ${service}`,
      text: `Smailee не смог обратиться к ${service}.\n\n${message}\n\nПовторные уведомления по этому сервису не отправляются 15 минут.`,
      html: `<p>Smailee не смог обратиться к <b>${service}</b>.</p><pre>${escapeHtml(message)}</pre><p>Повторные уведомления по этому сервису не отправляются 15 минут.</p>`,
    });
  } catch (mailError) {
    console.error("[service-alert] could not send alert email", mailError);
  }
}

export async function reportSharedApiSuccess(service: string) {
  await prisma.systemApiIncident.updateMany({ where: { service, resolvedAt: null }, data: { resolvedAt: new Date() } })
    .catch((dbError) => console.error("[service-alert] could not resolve incident", dbError));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
