"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrganizationAdmin } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { startWebsiteCrawl } from "@/app/(app)/app/settings/profile/actions";
import { processBusinessProfiles } from "@/server/businessProfileEngine";
import { disableDemoWorkspace, processGeneratingDemoWorkspaces, provisionDemoWorkspace } from "@/server/demoWorkspace";

export type DemoGenerationSnapshot = {
  demoStatus: string;
  lastError: string | null;
  crawl: null | {
    status: string;
    discoveredCount: number;
    crawledCount: number;
    analyzedCount: number;
    failedCount: number;
    pageLimit: number;
    error: string | null;
  };
};

export async function createDemoWorkspace(formData: FormData) {
  const workspace = await requireOrganizationAdmin();
  if (!workspace.organizationId) redirect("/app/setup");
  const websiteUrl = String(formData.get("websiteUrl") || "").trim() || null;
  const demo = await prisma.demoWorkspace.findUnique({ where: { organizationId: workspace.organizationId } });
  if (!demo || demo.status === "DISABLED") redirect("/app/analytics");
  if (websiteUrl) {
    await prisma.demoWorkspace.update({
      where: { organizationId: workspace.organizationId },
      data: { status: "GENERATING", websiteUrl, initializedAt: null, lastError: null },
    });
    const crawlResult = await startWebsiteCrawl(formData);
    if (crawlResult.error) {
      await prisma.demoWorkspace.update({
        where: { organizationId: workspace.organizationId },
        data: { status: "FAILED", lastError: crawlResult.error },
      });
    }
    revalidatePath("/app", "layout");
    redirect("/app/demo");
  }
  await provisionDemoWorkspace({
    organizationId: workspace.organizationId,
    userId: workspace.owner.id,
    organizationName: workspace.organizationName,
    websiteUrl,
  });
  revalidatePath("/app", "layout");
  redirect("/app/analytics?demo=ready");
}

export async function pollDemoGeneration(): Promise<DemoGenerationSnapshot> {
  const workspace = await requireOrganizationAdmin();
  if (!workspace.organizationId) return { demoStatus: "FAILED", lastError: "Организация не найдена", crawl: null };
  try {
    await processBusinessProfiles();
    await processGeneratingDemoWorkspaces(workspace.organizationId);
  } catch (error) {
    console.error("[demo] generation poll failed:", error);
  }
  const [demo, crawl] = await Promise.all([
    prisma.demoWorkspace.findUnique({ where: { organizationId: workspace.organizationId }, select: { status: true, lastError: true } }),
    prisma.websiteCrawl.findFirst({
      where: { organizationId: workspace.organizationId },
      orderBy: { createdAt: "desc" },
      select: { status: true, discoveredCount: true, crawledCount: true, analyzedCount: true, failedCount: true, pageLimit: true, error: true },
    }),
  ]);
  return {
    demoStatus: demo?.status ?? "FAILED",
    lastError: demo?.lastError ?? null,
    crawl,
  };
}

export async function leaveDemoWorkspace() {
  const workspace = await requireOrganizationAdmin();
  if (!workspace.organizationId) redirect("/app/setup");
  await disableDemoWorkspace(workspace.organizationId, workspace.owner.id);
  revalidatePath("/app", "layout");
  redirect("/app/setup");
}
