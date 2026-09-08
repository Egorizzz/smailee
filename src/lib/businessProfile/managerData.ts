import "server-only";

import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { emptyBusinessProfile, parseBusinessProfile } from "@/lib/businessProfile/types";
import { resolveBusinessProfileViews } from "@/lib/businessProfile/views";

type ProfileOwner = {
  companyName: string | null;
  websiteUrl: string | null;
  offer: string | null;
  targetAudience: string | null;
};

export async function loadBusinessProfileManagerData(organizationId: string | null, owner: ProfileOwner) {
  const stored = organizationId
    ? await prisma.organizationProfile.findUnique({
        where: { organizationId },
        include: { questions: { where: { status: { not: "DISMISSED" } }, orderBy: [{ critical: "desc" as const }, { createdAt: "asc" as const }] } },
      })
    : null;
  const crawls = organizationId
    ? await prisma.websiteCrawl.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } })
    : [];
  const crawl = crawls[0] ?? null;
  const fallback = emptyBusinessProfile(owner);
  const { draftProfile, publishedProfile } = resolveBusinessProfileViews({
    manualData: stored?.manualData,
    draftData: stored?.draftData,
    publishedData: stored?.publishedData,
    fallback,
  });

  const crawlView = (item: (typeof crawls)[number]) => ({
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
  });

  return {
    profile: draftProfile,
    publishedProfile,
    hasStoredDraft: Boolean(stored?.draftData ?? stored?.publishedData),
    crawl: crawl ? crawlView(crawl) : null,
    crawlHistory: crawls.map((item) => ({ ...crawlView(item), profile: item.profileData ? parseBusinessProfile(item.profileData) : null })),
    questions: (stored?.questions ?? []).map((question) => ({
      id: question.id,
      category: question.category,
      question: question.question,
      reason: question.reason,
      critical: question.critical,
      status: question.status,
      answer: question.answer,
    })),
    publishedAt: stored?.publishedAt?.toISOString() ?? null,
    stale: Boolean(stored?.staleAt && stored.staleAt <= new Date()),
    firecrawlConfigured: Boolean(config.firecrawl.apiKey),
  };
}
