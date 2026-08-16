"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganizationAdmin } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { emptyBusinessProfile, parseBusinessProfile } from "@/lib/businessProfile/types";
import {
  applyEditableBusinessProfile,
  editableBusinessProfileSchema,
  rememberEditableBusinessProfile,
  splitProfileEditorLines,
} from "@/lib/businessProfile/manualOverrides";
import { isUrlInScope, validatePublicWebsiteUrl } from "@/lib/businessProfile/siteSecurity";
import { websiteCrawler } from "@/lib/services/websiteCrawler";
import { reportSharedApiFailure, reportSharedApiSuccess } from "@/lib/services/serviceAlerts";
import {
  AUTO_CRAWL_MAP_LIMIT,
  automaticCrawlSettings,
} from "@/lib/businessProfile/crawlSettings";

export type ProfileActionResult = { ok?: string; error?: string };

const crawlSchema = z.object({
  websiteUrl: z.string().trim().min(3).max(2000),
  includePaths: z.string().max(4000).default(""),
  excludePaths: z.string().max(4000).default(""),
  allowSubdomains: z.boolean().default(false),
});

function splitPatterns(value: string) {
  return value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 30);
}

export async function startWebsiteCrawl(formData: FormData): Promise<ProfileActionResult> {
  const workspace = await requireOrganizationAdmin();
  if (!workspace.organizationId) return { error: "Организация ещё не создана — обновите страницу" };
  if (!config.firecrawl.apiKey) return { error: "FIRECRAWL_API_KEY не настроен в переменных приложения" };
  const parsed = crawlSchema.safeParse({
    websiteUrl: formData.get("websiteUrl"),
    includePaths: formData.get("includePaths") || "",
    excludePaths: formData.get("excludePaths") || "",
    allowSubdomains: formData.get("allowSubdomains") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте параметры обхода" };

  let rootUrl: string;
  try { rootUrl = await validatePublicWebsiteUrl(parsed.data.websiteUrl); }
  catch (error) { return { error: error instanceof Error ? error.message : "Некорректный URL" }; }

  const active = await prisma.websiteCrawl.findFirst({
    where: { organizationId: workspace.organizationId, status: { in: ["PENDING", "CRAWLING", "ANALYZING"] } },
    select: { id: true },
  });
  if (active) return { error: "Предыдущий анализ ещё выполняется" };

  if (workspace.actor.role !== "ADMIN") {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const recent = await prisma.websiteCrawl.count({
      where: {
        organizationId: workspace.organizationId,
        createdAt: { gte: since },
        OR: [{ status: { notIn: ["PENDING", "FAILED"] } }, { crawledCount: { gt: 0 } }],
      },
    });
    if (recent >= 3) return { error: "Повторный анализ сайта временно недоступен. Попробуйте позже." };
  }

  const storedProfile = await prisma.organizationProfile.findUnique({
    where: { organizationId: workspace.organizationId },
  });
  const legacyFallback = emptyBusinessProfile({
    companyName: workspace.owner.companyName,
    websiteUrl: workspace.owner.websiteUrl,
    offer: workspace.owner.offer,
    targetAudience: workspace.owner.targetAudience,
  });
  const manualData = parseBusinessProfile(storedProfile?.manualData, legacyFallback);
  const draftData = parseBusinessProfile(storedProfile?.draftData ?? storedProfile?.publishedData, manualData);
  manualData.websiteUrl = rootUrl;
  draftData.websiteUrl = rootUrl;
  await prisma.organizationProfile.upsert({
    where: { organizationId: workspace.organizationId },
    create: {
      organizationId: workspace.organizationId,
      manualData: manualData as Prisma.InputJsonValue,
      draftData: draftData as Prisma.InputJsonValue,
    },
    update: {
      manualData: manualData as Prisma.InputJsonValue,
      draftData: draftData as Prisma.InputJsonValue,
    },
  });

  const includePaths = splitPatterns(parsed.data.includePaths);
  const excludePaths = [
    "(^|/)(login|signin|signup|cart|checkout|search|tag|author|wp-admin)(/|$)",
    "(^|/)page/[0-9]+(/|$)",
    ...splitPatterns(parsed.data.excludePaths),
  ];
  const fallbackSettings = automaticCrawlSettings(rootUrl, []);
  const crawl = await prisma.websiteCrawl.create({
    data: {
      organizationId: workspace.organizationId,
      createdById: workspace.actor.id,
      rootUrl,
      pageLimit: fallbackSettings.pageLimit,
      maxDepth: fallbackSettings.maxDepth,
      includePaths,
      excludePaths,
      allowSubdomains: parsed.data.allowSubdomains,
    },
  });
  try {
    const mapped = await websiteCrawler.map(rootUrl, AUTO_CRAWL_MAP_LIMIT, parsed.data.allowSubdomains);
    const discoveredUrls = mapped.flatMap((item) => {
      const url = item.metadata && (item.metadata.url || item.metadata.sourceURL);
      return typeof url === "string" && isUrlInScope(url, rootUrl, parsed.data.allowSubdomains) ? [url] : [];
    });
    const crawlSettings = automaticCrawlSettings(rootUrl, discoveredUrls);
    const started = await websiteCrawler.start({
      crawlId: crawl.id,
      organizationId: workspace.organizationId,
      url: rootUrl,
      limit: crawlSettings.pageLimit,
      maxDepth: crawlSettings.maxDepth,
      includePaths,
      excludePaths,
      allowSubdomains: parsed.data.allowSubdomains,
    });
    await reportSharedApiSuccess("Firecrawl");
    await prisma.websiteCrawl.update({
      where: { id: crawl.id },
      data: {
        providerJobId: started.jobId,
        discoveredCount: crawlSettings.discoveredCount,
        pageLimit: crawlSettings.pageLimit,
        maxDepth: crawlSettings.maxDepth,
        startedAt: new Date(),
        nextPollAt: new Date(Date.now() + config.firecrawl.pollMs),
      },
    });
    await prisma.websiteCrawl.updateMany({
      where: { id: crawl.id, status: "PENDING" },
      data: { status: "CRAWLING" },
    });
  } catch (error) {
    await reportSharedApiFailure("Firecrawl", error);
    await prisma.websiteCrawl.update({
      where: { id: crawl.id },
      data: { status: "FAILED", completedAt: new Date(), error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000) },
    });
    return { error: error instanceof Error ? error.message : "Не удалось запустить анализ сайта" };
  }
  revalidatePath("/app/settings/profile");
  return { ok: "Обход запущен. Страницу можно закрыть — обработка продолжится в фоне." };
}

export async function cancelWebsiteCrawl(crawlId: string): Promise<ProfileActionResult> {
  const workspace = await requireOrganizationAdmin();
  if (!workspace.organizationId) return { error: "Организация не найдена" };
  const crawl = await prisma.websiteCrawl.findFirst({ where: { id: crawlId, organizationId: workspace.organizationId } });
  if (!crawl) return { error: "Задание не найдено" };
  if (crawl.providerJobId && crawl.status === "CRAWLING") {
    await websiteCrawler.cancel(crawl.providerJobId).catch((error) => console.error("[business-profile] cancel failed", error));
  }
  await prisma.websiteCrawl.update({ where: { id: crawl.id }, data: { status: "CANCELED", completedAt: new Date() } });
  revalidatePath("/app/settings/profile");
  return { ok: "Анализ остановлен" };
}

export async function saveProfileDraft(formData: FormData): Promise<ProfileActionResult> {
  const workspace = await requireOrganizationAdmin();
  if (!workspace.organizationId) return { error: "Организация не найдена" };
  const current = await prisma.organizationProfile.findUnique({ where: { organizationId: workspace.organizationId } });
  const legacyFallback = emptyBusinessProfile({
    companyName: workspace.owner.companyName,
    websiteUrl: workspace.owner.websiteUrl,
    offer: workspace.owner.offer,
    targetAudience: workspace.owner.targetAudience,
  });
  const data = parseBusinessProfile(current?.draftData ?? current?.publishedData, legacyFallback);
  const companyName = String(formData.get("companyName") || "").trim().slice(0, 300) || null;
  const websiteRaw = String(formData.get("websiteUrl") || "").trim();
  let websiteUrl: string | null = null;
  if (websiteRaw) {
    try { websiteUrl = await validatePublicWebsiteUrl(websiteRaw); }
    catch (error) { return { error: error instanceof Error ? error.message : "Некорректный URL" }; }
  }
  const offer = String(formData.get("offer") || "").trim().slice(0, 5000);
  const targetAudience = String(formData.get("targetAudience") || "").trim().slice(0, 5000);
  data.companyName = companyName;
  data.websiteUrl = websiteUrl;
  data.offers = offer ? [offer] : [];
  data.targetAudiences = targetAudience ? [targetAudience] : [];
  data.manualNotes = String(formData.get("manualNotes") || "").trim().slice(0, 10_000);
  const manualData = parseBusinessProfile(current?.manualData, emptyBusinessProfile());
  manualData.companyName = companyName;
  manualData.websiteUrl = websiteUrl;
  manualData.offers = offer ? [offer] : [];
  manualData.targetAudiences = targetAudience ? [targetAudience] : [];
  manualData.manualNotes = data.manualNotes;
  manualData.manualOverrides = [...new Set([
    ...manualData.manualOverrides,
    "companyName" as const,
    "websiteUrl" as const,
    "offers" as const,
    "targetAudiences" as const,
    "manualNotes" as const,
  ])];
  await prisma.organizationProfile.upsert({
    where: { organizationId: workspace.organizationId },
    create: {
      organizationId: workspace.organizationId,
      manualData: manualData as Prisma.InputJsonValue,
      draftData: data as Prisma.InputJsonValue,
    },
    update: {
      manualData: manualData as Prisma.InputJsonValue,
      draftData: data as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/app/settings/profile");
  revalidatePath("/app/settings");
  return { ok: "Черновик сохранён" };
}

export async function saveAnalyzedProfileDraft(formData: FormData): Promise<ProfileActionResult> {
  const workspace = await requireOrganizationAdmin();
  if (!workspace.organizationId) return { error: "Организация не найдена" };
  const current = await prisma.organizationProfile.findUnique({ where: { organizationId: workspace.organizationId } });

  const companyName = String(formData.get("companyName") || "").trim().slice(0, 300) || null;
  const websiteRaw = String(formData.get("websiteUrl") || "").trim();
  let websiteUrl: string | null = null;
  if (websiteRaw) {
    try { websiteUrl = await validatePublicWebsiteUrl(websiteRaw); }
    catch (error) { return { error: error instanceof Error ? error.message : "Некорректный URL" }; }
  }

  const productsRaw = String(formData.get("products") || "[]");
  if (productsRaw.length > 50_000) return { error: "Список продуктов слишком большой" };
  let products: unknown;
  try { products = JSON.parse(productsRaw); }
  catch { return { error: "Не удалось прочитать список продуктов" }; }

  const parsed = editableBusinessProfileSchema.safeParse({
    companyName,
    websiteUrl,
    summary: String(formData.get("summary") || ""),
    offers: splitProfileEditorLines(String(formData.get("offers") || "")),
    products,
    targetAudiences: splitProfileEditorLines(String(formData.get("targetAudiences") || "")),
    painPoints: splitProfileEditorLines(String(formData.get("painPoints") || "")),
    differentiators: splitProfileEditorLines(String(formData.get("differentiators") || "")),
    proof: splitProfileEditorLines(String(formData.get("proof") || "")),
    geography: splitProfileEditorLines(String(formData.get("geography") || "")),
    salesProcess: splitProfileEditorLines(String(formData.get("salesProcess") || "")),
    restrictions: splitProfileEditorLines(String(formData.get("restrictions") || "")),
    tone: String(formData.get("tone") || ""),
    manualNotes: String(formData.get("manualNotes") || ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля черновика" };

  const edited = {
    ...parsed.data,
    products: parsed.data.products
      .filter((item) => item.name.trim())
      .map((item) => ({ ...item, pricingConfirmed: false })),
  };
  const fallback = emptyBusinessProfile({
    companyName: workspace.owner.companyName,
    websiteUrl: workspace.owner.websiteUrl,
    offer: workspace.owner.offer,
    targetAudience: workspace.owner.targetAudience,
  });
  const draftData = applyEditableBusinessProfile(
    parseBusinessProfile(current?.draftData ?? current?.publishedData, fallback),
    edited,
  );
  const manualData = rememberEditableBusinessProfile(
    parseBusinessProfile(current?.manualData, emptyBusinessProfile()),
    edited,
  );
  await prisma.organizationProfile.upsert({
    where: { organizationId: workspace.organizationId },
    create: {
      organizationId: workspace.organizationId,
      draftData: draftData as Prisma.InputJsonValue,
      manualData: manualData as Prisma.InputJsonValue,
    },
    update: {
      draftData: draftData as Prisma.InputJsonValue,
      manualData: manualData as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/app/settings/profile");
  return { ok: "Изменения сохранены в черновике" };
}

export async function answerProfileQuestion(questionId: string, answer: string): Promise<ProfileActionResult> {
  const workspace = await requireOrganizationAdmin();
  if (!workspace.organizationId) return { error: "Организация не найдена" };
  const question = await prisma.profileQuestion.findFirst({ where: { id: questionId, profile: { organizationId: workspace.organizationId } } });
  if (!question) return { error: "Вопрос не найден" };
  const normalized = answer.trim().slice(0, 5000);
  await prisma.profileQuestion.update({
    where: { id: question.id },
    data: { answer: normalized || null, status: normalized ? "ANSWERED" : "DISMISSED" },
  });
  revalidatePath("/app/settings/profile");
  return { ok: normalized ? "Ответ сохранён" : "Вопрос пропущен" };
}

export async function publishProfile(confirmPricing: boolean): Promise<ProfileActionResult> {
  const workspace = await requireOrganizationAdmin();
  if (!workspace.organizationId) return { error: "Организация не найдена" };
  const profile = await prisma.organizationProfile.findUnique({
    where: { organizationId: workspace.organizationId },
    include: { questions: { where: { status: "ANSWERED", answer: { not: null } } }, snapshots: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!profile?.draftData) return { error: "Сначала заполните или проанализируйте профиль" };
  const data = parseBusinessProfile(profile.draftData);
  if (!data.offers.length || !data.targetAudiences.length) return { error: "Для публикации заполните оффер и целевую аудиторию" };
  const manualData = parseBusinessProfile(profile.manualData);
  if (profile.questions.length) {
    const answers = profile.questions.map((item) => `${item.question}: ${item.answer}`);
    data.manualNotes = [...new Set([data.manualNotes, ...answers].filter(Boolean))].join("\n");
    manualData.manualNotes = [...new Set([manualData.manualNotes, ...answers].filter(Boolean))].join("\n");
  }
  data.products = data.products.map((product) => ({
    ...product,
    pricingConfirmed: Boolean(confirmPricing && product.pricing),
  }));
  const now = new Date();
  const version = (profile.snapshots[0]?.version ?? 0) + 1;
  await prisma.$transaction([
    prisma.organizationProfile.update({
      where: { id: profile.id },
      data: {
        manualData: manualData as Prisma.InputJsonValue,
        draftData: data as Prisma.InputJsonValue,
        publishedData: data as Prisma.InputJsonValue,
        publishedSourceCrawlId: profile.sourceCrawlId,
        publishedAt: now,
        staleAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      },
    }),
    prisma.organizationProfileSnapshot.create({ data: { profileId: profile.id, version, data: data as Prisma.InputJsonValue, createdById: workspace.actor.id } }),
    prisma.user.update({
      where: { id: workspace.owner.id },
      data: {
        companyName: data.companyName,
        websiteUrl: data.websiteUrl,
        offer: data.offers.join("\n") || null,
        targetAudience: data.targetAudiences.join("\n") || null,
      },
    }),
    ...(data.companyName ? [prisma.organization.update({ where: { id: workspace.organizationId }, data: { name: data.companyName } })] : []),
  ]);
  revalidatePath("/app/settings/profile");
  revalidatePath("/app");
  revalidatePath("/app/setup");
  revalidatePath("/app/campaigns/new");
  revalidatePath("/app/leads");
  return { ok: `Профиль опубликован, версия ${version}` };
}
