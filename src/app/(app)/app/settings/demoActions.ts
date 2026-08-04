"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdmin } from "@/lib/organization";
import { activateDemoAccess } from "@/server/billing";

export async function startDemoAccess() {
  const { owner } = await requireOrganizationAdmin();
  await activateDemoAccess(owner.id);
  revalidatePath("/app/settings");
  revalidatePath("/app/billing");
}
