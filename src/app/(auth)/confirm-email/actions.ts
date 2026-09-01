"use server";

import { redirect } from "next/navigation";
import { consumeAuthToken, inspectAuthToken } from "@/lib/authTokens";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function confirmEmailChange(formData: FormData) {
  const token = String(formData.get("token") || "");
  const inspected = await inspectAuthToken(token);
  if (!inspected || inspected.type !== "EMAIL_CHANGE") redirect("/confirm-email?error=expired");
  const request = await prisma.accountEmailChange.findUnique({ where: { userId: inspected.userId } });
  if (!request || request.expiresAt <= new Date()) redirect("/confirm-email?error=expired");
  const occupied = await prisma.user.findUnique({ where: { email: request.newEmail }, select: { id: true } });
  if (occupied && occupied.id !== inspected.userId) redirect("/confirm-email?error=occupied");
  if (!await consumeAuthToken(token)) redirect("/confirm-email?error=expired");
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: inspected.userId }, data: { email: request.newEmail, emailVerifiedAt: new Date(), emailPending: false } });
    await tx.accountEmailChange.delete({ where: { userId: inspected.userId } });
    return updated;
  });
  await createSession({ userId: user.id, email: user.email });
  redirect("/app/settings/security?changed=1");
}
