"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function saveOnboarding(formData: FormData) {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      companyName: String(formData.get("companyName") || "") || null,
      websiteUrl: String(formData.get("websiteUrl") || "") || null,
      offer: String(formData.get("offer") || "") || null,
      targetAudience: String(formData.get("targetAudience") || "") || null,
      aiModerationEnabled: formData.get("aiModerationEnabled") === "on",
    },
  });
  revalidatePath("/app/settings");
  revalidatePath("/app");
}
