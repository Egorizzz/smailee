import { requireOrganizationAdmin } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { emptyBusinessProfile, parseBusinessProfile } from "@/lib/businessProfile/types";
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
  const crawls = workspace.organizationId
    ? await prisma.websiteCrawl.findMany({ where: { organizationId: workspace.organizationId }, orderBy: { createdAt: "desc" } })
    : [];
  const crawl = crawls[0] ?? null;
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
          synthesizedAt: crawl.synthesizedAt?.toISOString() ?? null,
          profileVersion: crawl.profileVersion,
          canRetrySynthesis: crawl.analyzedCount > 0 && (crawl.status === "FAILED" || (crawl.status === "READY_FOR_REVIEW" && !crawl.profileData)),
        } : null}
        crawlHistory={crawls.map((item) => ({
          id: item.id,
          rootUrl: item.rootUrl,
          status: item.status,
          discoveredCount: item.discoveredCount,
          crawledCount: item.crawledCount,
          analyzedCount: item.analyzedCount,
          failedCount: item.failedCount,
          pageLimit: item.pageLimit,
          error: item.error,
          createdAt: item.createdAt.toISOString(),
          synthesizedAt: item.synthesizedAt?.toISOString() ?? null,
          profileVersion: item.profileVersion,
          canRetrySynthesis: item.analyzedCount > 0 && (item.status === "FAILED" || (item.status === "READY_FOR_REVIEW" && !item.profileData)),
          profile: item.profileData ? parseBusinessProfile(item.profileData) : null,
        }))}
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
