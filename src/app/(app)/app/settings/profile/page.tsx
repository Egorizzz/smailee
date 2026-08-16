import Link from "next/link";
import { requireOrganizationAdmin } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { emptyBusinessProfile } from "@/lib/businessProfile/types";
import { BusinessProfileManager } from "@/components/BusinessProfileManager";
import { resolveBusinessProfileViews } from "@/lib/businessProfile/views";

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
      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
        <Link href="/app/settings" className="-mb-px whitespace-nowrap border-b-2 border-transparent px-4 py-2.5 text-sm font-semibold text-ink-500 hover:text-slate-900">Основные</Link>
        <Link href="/app/settings?tab=team" className="-mb-px whitespace-nowrap border-b-2 border-transparent px-4 py-2.5 text-sm font-semibold text-ink-500 hover:text-slate-900">Команда</Link>
        <Link href="/app/settings/profile" className="-mb-px whitespace-nowrap border-b-2 border-mint-500 px-4 py-2.5 text-sm font-semibold text-slate-900">Профиль организации</Link>
      </div>
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
