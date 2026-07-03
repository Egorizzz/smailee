"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleInboundReply } from "@/server/inboundEngine";

// Симуляция ответа клиента на письмо — для проверки AI-диалога и квалификации
// без реального inbound. В проде эту же логику дёргает вебхук /api/inbound.
export async function simulateReply(formData: FormData) {
  const user = await requireUser();
  const messageId = String(formData.get("messageId"));
  const text =
    String(formData.get("text") || "") ||
    "Здравствуйте! Интересно, сколько это стоит? Готовы обсудить.";

  // проверяем принадлежность
  const msg = await prisma.message.findFirst({
    where: { id: messageId, campaign: { userId: user.id } },
  });
  if (!msg) return;

  await handleInboundReply({ messageId, inboundBody: text });
  revalidatePath(`/app/campaigns`);
  revalidatePath(`/app/leads`);
}
