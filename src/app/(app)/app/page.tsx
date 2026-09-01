import { redirect } from "next/navigation";
import { requireWorkspace, workspaceHome } from "@/lib/organization";
import { prisma } from "@/lib/prisma";

// Главная (R2, setup-aware): пока первичная настройка не завершена и визард
// не закрыт крестиком — ведём в /app/setup; иначе — в доступный рабочий раздел.
export default async function AppHome() {
  const workspace = await requireWorkspace();
  const user = workspace.owner;

  if (workspace.role === "ORG_ADMIN" && !user.setupClosedAt) {
    const controlReply = await prisma.message.findFirst({
      where: { campaign: { userId: user.id, isDemo: false }, contact: { isControl: true }, repliedAt: { not: null } },
      select: { id: true },
    });
    const setupDone = Boolean(controlReply) && !user.emailPending;
    if (!setupDone) redirect("/app/setup");
  }

  redirect(workspaceHome(workspace));
}
