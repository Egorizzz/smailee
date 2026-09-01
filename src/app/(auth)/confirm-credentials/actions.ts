"use server";

import { redirect } from "next/navigation";
import { consumeAuthToken, inspectAuthToken } from "@/lib/authTokens";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function confirmCredentialChange(formData: FormData) {
  const token = String(formData.get("token") || "");
  const inspected = await inspectAuthToken(token);
  if (!inspected || inspected.type !== "CREDENTIAL_CHANGE") redirect("/confirm-credentials?error=expired");
  const request = await prisma.accountCredentialChange.findUnique({ where: { userId: inspected.userId } });
  if (!request || request.expiresAt <= new Date()) redirect("/confirm-credentials?error=expired");
  const consumed = await consumeAuthToken(token);
  if (!consumed) redirect("/confirm-credentials?error=expired");
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: inspected.userId },
      data: {
        ...(request.newPasswordHash ? { passwordHash: request.newPasswordHash, passwordEnabled: true, mustChangePassword: false } : {}),
        emailVerifiedAt: new Date(),
      },
    });
    await tx.accountCredentialChange.delete({ where: { userId: inspected.userId } });
    return updated;
  });
  await createSession({ userId: user.id, email: user.email });
  redirect("/app/settings/security?changed=1");
}
