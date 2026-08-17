import { requireOrganizationAdmin } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { emptyBusinessProfile } from "@/lib/businessProfile/types";
import { BusinessProfileManager } from "@/components/BusinessProfileManager";
import { resolveBusinessProfileViews } from "@/lib/businessProfile/views";
import { SettingsTabs } from "@/components/SettingsTabs";

export default async function BusinessProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const workspace = await requireOrganizationAdmin();
  const { setup } = await searchParams;
  const stored = workspace.organizationId
    ? await prisma.organizationProfile.findUnique({
        where: { organizationId: workspace.organizationId },
        include: { questions: { where: { status: { not: "DISMISSED" } }, orderBy: [{ critical: "desc" }, { createdAt: "asc" }] } },
      })
    : null;
  const crawl = workspace.organizationId
    ? await prisma.websiteCrawl.findFirst({ where: { organizationId: workspace.organizationId }, orderBy: { createdAt: "desc" } })
    : null;
  const fallback = emptyBusinessProfile({
    companyName: workspace.owner.companyName,
    websiteUrl: workspace.owner.websiteUrl,
    offer: workspace.owner.offer,
    targetAudience: workspace.owner.targetAudience,
  });
  const { draftProfile, publishedProfile } = resolveBusinessProfileViews({
    manualData: stored?.manualData,
    draftData: stored?.draftData,
    publishedData: stored?.publishedData,
    fallback,
  });
  const stale = Boolean(stored?.staleAt && stored.staleAt <= new Date());

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Настройки</h1>
      <p className="mt-1 text-ink-500">Контекст организации, которым пользуется ИИ.</p>
      <SettingsTabs active="profile" organizationAdmin />
      <BusinessProfileManager
        profile={draftProfile}
        publishedProfile={publishedProfile}
        hasStoredDraft={Boolean(stored?.draftData ?? stored?.publishedData)}
        crawl={crawl ? {
          id: crawl.id,
          rootUrl: crawl.rootUrl,
          status: crawl.status,
          discoveredCount: crawl.discoveredCount,
          crawledCount: crawl.crawledCount,
          analyzedCount: crawl.analyzedCount,
          failedCount: crawl.failedCount,
          pageLimit: crawl.pageLimit,
          error: crawl.error,
          createdAt: crawl.createdAt.toISOString(),
        } : null}
        questions={(stored?.questions ?? []).map((question) => ({
          id: question.id,
          category: question.category,
          question: question.question,
          reason: question.reason,
          critical: question.critical,
          status: question.status,
          answer: question.answer,
        }))}
        publishedAt={stored?.publishedAt?.toISOString() ?? null}
        stale={stale}
        firecrawlConfigured={Boolean(config.firecrawl.apiKey)}
        setupMode={setup === "1"}
      />
    </div>
  );
}
