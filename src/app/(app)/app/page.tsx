import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";

// Главная (R2, setup-aware): пока первичная настройка не завершена и визард
// не закрыт крестиком — ведём в /app/setup; иначе главная продукта = «Лиды».
export default async function AppHome() {
  const workspace = await requireWorkspace();
  const user = workspace.owner;

  if (workspace.role === "ORG_ADMIN" && !user.setupClosedAt) {
    const [mailboxes, contacts, campaigns] = await Promise.all([
      prisma.mailbox.count({ where: { userId: user.id } }),
      prisma.contact.count({ where: { userId: user.id } }),
      prisma.campaign.count({ where: { userId: user.id } }),
    ]);
    const setupDone =
      Boolean(user.offer && user.targetAudience) && mailboxes > 0 && contacts > 0 && campaigns > 0;
    if (!setupDone) redirect("/app/setup");
  }

  redirect("/app/leads");
}
