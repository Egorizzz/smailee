import { redirect } from "next/navigation";
import { requireWorkspace, workspaceHome } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { getPublishedBusinessProfile, isBusinessProfileReady } from "@/lib/businessProfile/context";

// Главная (R2, setup-aware): пока первичная настройка не завершена и визард
// не закрыт крестиком — ведём в /app/setup; иначе — в доступный рабочий раздел.
export default async function AppHome() {
  const workspace = await requireWorkspace();
  const user = workspace.owner;

  if (workspace.role === "ORG_ADMIN" && !user.setupClosedAt) {
    const [mailboxes, contacts, campaigns, businessProfile] = await Promise.all([
      prisma.mailbox.count({ where: { userId: user.id } }),
      prisma.contact.count({ where: { userId: user.id } }),
      prisma.campaign.count({ where: { userId: user.id } }),
      getPublishedBusinessProfile(user),
    ]);
    const setupDone =
      businessProfile.published && isBusinessProfileReady(businessProfile.profile) && mailboxes > 0 && contacts > 0 && campaigns > 0;
    if (!setupDone) redirect("/app/setup");
  }

  redirect(workspaceHome(workspace));
}
