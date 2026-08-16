import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { canonicalizePageUrl, isUrlInScope } from "@/lib/businessProfile/siteSecurity";
import { emptyBusinessProfile, pageAnalysisSchema, parseBusinessProfile } from "@/lib/businessProfile/types";
import { websiteCrawler, type WebsiteDocument } from "@/lib/services/websiteCrawler";
import { analyzeBusinessPage, synthesizeBusinessProfile } from "@/lib/services/llm";
import { reportSharedApiFailure, reportSharedApiSuccess } from "@/lib/services/serviceAlerts";
import { queueTechnicalAlert } from "./adminNotifications";

const PAGE_BATCH = 3;
const MAX_MARKDOWN_CHARS = 100_000;
const STALE_PAGE_CLAIM_MS = 15 * 60_000;

function retryAt(attempt: number) {
  return new Date(Date.now() + Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1)));
}

function metadataString(metadata: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function metadataNumber(metadata: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(metadata?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

export async function ingestWebsiteDocuments(crawlId: string, documents: WebsiteDocument[]) {
  const crawl = await prisma.websiteCrawl.findUnique({ where: { id: crawlId } });
  if (!crawl || crawl.status === "CANCELED" || crawl.status === "FAILED") return 0;

  let accepted = 0;
  for (const document of documents) {
    if (!document || typeof document.markdown !== "string" || !document.markdown.trim()) continue;
    const rawUrl = metadataString(document.metadata, "sourceURL", "url");
    if (!rawUrl || !isUrlInScope(rawUrl, crawl.rootUrl, crawl.allowSubdomains)) continue;
    let canonicalUrl: string;
    try { canonicalUrl = canonicalizePageUrl(rawUrl); } catch { continue; }

    const currentCount = await prisma.websitePage.count({ where: { crawlId } });
    if (currentCount >= crawl.pageLimit) break;
    const markdown = document.markdown.trim().slice(0, MAX_MARKDOWN_CHARS);
    const contentHash = createHash("sha256").update(markdown).digest("hex");
    const contentType = metadataString(document.metadata, "contentType") || (rawUrl.toLowerCase().endsWith(".pdf") ? "application/pdf" : null);
    await prisma.websitePage.upsert({
      where: { crawlId_canonicalUrl: { crawlId, canonicalUrl } },
      create: {
        crawlId,
        url: rawUrl,
        canonicalUrl,
        title: metadataString(document.metadata, "title") || null,
        description: metadataString(document.metadata, "description") || null,
        contentType,
        statusCode: metadataNumber(document.metadata, "statusCode"),
        markdown,
        contentHash,
      },
      update: {
        url: rawUrl,
        title: metadataString(document.metadata, "title") || null,
        description: metadataString(document.metadata, "description") || null,
        contentType,
        statusCode: metadataNumber(document.metadata, "statusCode"),
        markdown,
        contentHash,
      },
    });
    accepted++;
  }
  const crawledCount = await prisma.websitePage.count({ where: { crawlId } });
  await prisma.websiteCrawl.update({ where: { id: crawlId }, data: { crawledCount } });
  return accepted;
}

export async function failWebsiteCrawl(crawlId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const crawl = await prisma.websiteCrawl.update({
    where: { id: crawlId },
    data: { status: "FAILED", error: message.slice(0, 2000), completedAt: new Date() },
    include: { organization: { select: { ownerId: true } } },
  });
  await queueTechnicalAlert({
    ownerId: crawl.organization.ownerId,
    type: "WEBSITE_CRAWL_FAILED",
    resourceKey: crawl.id,
    subject: "[Smailee] Не удалось проанализировать сайт",
    text: `Анализ сайта ${crawl.rootUrl} остановлен.\n\n${message}\n\nМожно исправить настройки и запустить анализ повторно.`,
  }).catch((alertError) => console.error("[business-profile] could not queue crawl alert", alertError));
}

async function pollCrawls(now: Date) {
  const crawls = await prisma.websiteCrawl.findMany({
    where: { status: "CRAWLING", nextPollAt: { lte: now }, providerJobId: { not: null } },
    orderBy: { nextPollAt: "asc" },
    take: 3,
  });
  let checked = 0;
  for (const crawl of crawls) {
    const claimed = await prisma.websiteCrawl.updateMany({
      where: { id: crawl.id, status: "CRAWLING", nextPollAt: { lte: now } },
      data: { nextPollAt: new Date(now.getTime() + config.firecrawl.pollMs), attempts: { increment: 1 } },
    });
    if (!claimed.count || !crawl.providerJobId) continue;
    checked++;
    try {
      const snapshot = await websiteCrawler.status(crawl.providerJobId);
      await reportSharedApiSuccess("Firecrawl");
      await ingestWebsiteDocuments(crawl.id, snapshot.documents);
      if (snapshot.status === "failed") {
        await failWebsiteCrawl(crawl.id, new Error("Firecrawl завершил обход с ошибкой"));
      } else {
        await prisma.websiteCrawl.update({
          where: { id: crawl.id },
          data: {
            discoveredCount: Math.max(crawl.discoveredCount, snapshot.total),
            crawledCount: snapshot.completed,
            creditsUsed: snapshot.creditsUsed,
            attempts: 0,
            status: snapshot.status === "completed" ? "ANALYZING" : "CRAWLING",
            completedAt: snapshot.status === "completed" ? now : null,
            nextPollAt: new Date(now.getTime() + config.firecrawl.pollMs),
          },
        });
      }
    } catch (error) {
      await reportSharedApiFailure("Firecrawl", error);
      if (crawl.attempts + 1 >= 5) await failWebsiteCrawl(crawl.id, error);
      else await prisma.websiteCrawl.update({
        where: { id: crawl.id },
        data: { error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000), nextPollAt: retryAt(crawl.attempts + 1) },
      });
    }
  }
  return checked;
}

async function analyzePages(now: Date) {
  // A worker can stop after claiming a page but before persisting the LLM result.
  // Re-open old claims so a restart cannot leave a crawl stuck forever.
  await prisma.websitePage.updateMany({
    where: {
      analysisStatus: "PROCESSING",
      updatedAt: { lt: new Date(now.getTime() - STALE_PAGE_CLAIM_MS) },
      crawl: { status: "ANALYZING" },
    },
    data: {
      analysisStatus: "PENDING",
      nextAttemptAt: now,
      error: "Обработка была прервана и автоматически возобновлена",
    },
  });
  const pages = await prisma.websitePage.findMany({
    where: {
      analysisStatus: "PENDING",
      nextAttemptAt: { lte: now },
      crawl: { status: "ANALYZING" },
    },
    orderBy: { createdAt: "asc" },
    take: PAGE_BATCH,
  });
  let analyzed = 0;
  for (const page of pages) {
    const claimed = await prisma.websitePage.updateMany({
      where: { id: page.id, analysisStatus: "PENDING", nextAttemptAt: { lte: now } },
      data: { analysisStatus: "PROCESSING", attempts: { increment: 1 } },
    });
    if (!claimed.count) continue;
    try {
      const analysis = await analyzeBusinessPage({ url: page.url, title: page.title, markdown: page.markdown });
      await prisma.websitePage.update({
        where: { id: page.id },
        data: { analysisStatus: "DONE", analysis: analysis as Prisma.InputJsonValue, error: null },
      });
      analyzed++;
    } catch (error) {
      const attempt = page.attempts + 1;
      await prisma.websitePage.update({
        where: { id: page.id },
        data: attempt >= 3
          ? { analysisStatus: "FAILED", error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000) }
          : { analysisStatus: "PENDING", nextAttemptAt: retryAt(attempt), error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000) },
      });
    }
  }
  const touchedCrawls = [...new Set(pages.map((page) => page.crawlId))];
  for (const crawlId of touchedCrawls) {
    const [done, failed] = await Promise.all([
      prisma.websitePage.count({ where: { crawlId, analysisStatus: "DONE" } }),
      prisma.websitePage.count({ where: { crawlId, analysisStatus: "FAILED" } }),
    ]);
    await prisma.websiteCrawl.update({ where: { id: crawlId }, data: { analyzedCount: done, failedCount: failed } });
  }
  return analyzed;
}

function selectFacts(pages: Array<{ url: string; analysis: Prisma.JsonValue | null }>) {
  const buckets = new Map<string, Array<{ category: string; value: string; evidence: string; confidence: number; sensitive: boolean; sourceUrl: string }>>();
  for (const page of pages) {
    const parsed = pageAnalysisSchema.safeParse(page.analysis);
    if (!parsed.success || !parsed.data.relevant) continue;
    for (const fact of parsed.data.facts) {
      const bucket = buckets.get(fact.category) ?? [];
      bucket.push({ ...fact, sourceUrl: page.url });
      buckets.set(fact.category, bucket);
    }
  }
  return [...buckets.values()].flatMap((facts) => facts.sort((a, b) => b.confidence - a.confidence).slice(0, 20));
}

async function finalizeCrawls(now: Date) {
  const crawls = await prisma.websiteCrawl.findMany({
    where: { status: "ANALYZING", nextPollAt: { lte: now } },
    include: { organization: { include: { owner: true, businessProfile: true } } },
    orderBy: { updatedAt: "asc" },
    take: 2,
  });
  let finalized = 0;
  for (const crawl of crawls) {
    const remaining = await prisma.websitePage.count({ where: { crawlId: crawl.id, analysisStatus: { in: ["PENDING", "PROCESSING"] } } });
    if (remaining) {
      await prisma.websiteCrawl.update({ where: { id: crawl.id }, data: { nextPollAt: new Date(now.getTime() + 15_000) } });
      continue;
    }
    const pages = await prisma.websitePage.findMany({
      where: { crawlId: crawl.id, analysisStatus: "DONE" },
      select: { url: true, title: true, analysis: true },
    });
    if (!pages.length) {
      await failWebsiteCrawl(crawl.id, new Error("Не удалось извлечь данные ни с одной страницы сайта"));
      continue;
    }
    const claimed = await prisma.websiteCrawl.updateMany({
      where: { id: crawl.id, status: "ANALYZING", nextPollAt: { lte: now } },
      data: { nextPollAt: new Date(now.getTime() + 10 * 60_000) },
    });
    if (!claimed.count) continue;
    try {
      const owner = crawl.organization.owner;
      // Only fields explicitly maintained by the administrator are overrides.
      // Products/facts from a previous crawl must not outrank fresher evidence.
      const legacyFallback = emptyBusinessProfile({
        companyName: owner.companyName,
        websiteUrl: owner.websiteUrl,
        offer: owner.offer,
        targetAudience: owner.targetAudience,
      });
      const manual = parseBusinessProfile(crawl.organization.businessProfile?.manualData, legacyFallback);
      const answered = crawl.organization.businessProfile
        ? await prisma.profileQuestion.findMany({ where: { profileId: crawl.organization.businessProfile.id, status: "ANSWERED", answer: { not: null } } })
        : [];
      if (answered.length) {
        manual.manualNotes = [manual.manualNotes, ...answered.map((item) => `${item.question}: ${item.answer}`)].filter(Boolean).join("\n");
      }
      const synthesis = await synthesizeBusinessProfile({
        facts: selectFacts(pages),
        manual,
        sources: pages.map((page) => ({ url: page.url, title: page.title ?? "" })),
      });
      const profile = await prisma.organizationProfile.upsert({
        where: { organizationId: crawl.organizationId },
        create: { organizationId: crawl.organizationId, draftData: synthesis.profile as Prisma.InputJsonValue, sourceCrawlId: crawl.id },
        update: { draftData: synthesis.profile as Prisma.InputJsonValue, sourceCrawlId: crawl.id },
      });
      await prisma.$transaction([
        prisma.profileQuestion.deleteMany({ where: { profileId: profile.id } }),
        ...synthesis.questions.map((question) => prisma.profileQuestion.create({ data: { profileId: profile.id, ...question } })),
        prisma.websiteCrawl.update({ where: { id: crawl.id }, data: { status: "READY_FOR_REVIEW", error: null, nextPollAt: now } }),
      ]);
      finalized++;
    } catch (error) {
      const attempts = crawl.attempts + 1;
      if (attempts >= 3) await failWebsiteCrawl(crawl.id, error);
      else await prisma.websiteCrawl.update({
        where: { id: crawl.id },
        data: { attempts, error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000), nextPollAt: retryAt(attempts) },
      });
    }
  }
  return finalized;
}

export async function processBusinessProfiles(now = new Date()) {
  const polled = await pollCrawls(now);
  const analyzed = await analyzePages(now);
  const finalized = await finalizeCrawls(now);
  return { polled, analyzed, finalized };
}

export async function purgeExpiredWebsiteContent(now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60_000);
  const result = await prisma.websitePage.updateMany({
    where: { updatedAt: { lt: cutoff }, markdown: { not: "" } },
    data: { markdown: "" },
  });
  return result.count;
}
