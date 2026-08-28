import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessProfileDataSchema, emptyBusinessProfile, parseBusinessProfile, type BusinessProfileData } from "@/lib/businessProfile/types";
import { DEMO_EXAMPLE_EMAILS_MAX, isPersistentDemoScenario, type DemoCampaignStats } from "@/lib/demoWorkspace";

const SEGMENTS = [
  { name: "IT и разработка", industry: "Информационные технологии", role: "CTO" },
  { name: "Профессиональные услуги", industry: "Консалтинг", role: "Управляющий партнёр" },
  { name: "E-commerce", industry: "Электронная коммерция", role: "Коммерческий директор" },
  { name: "Производство", industry: "Промышленность", role: "Директор по развитию" },
  { name: "Недвижимость", industry: "Недвижимость", role: "Директор по маркетингу" },
  { name: "Образование", industry: "EdTech", role: "Руководитель продукта" },
] as const;

const FIRST_NAMES = ["Анна", "Максим", "Ирина", "Артём", "Елена", "Дмитрий", "Ольга", "Алексей", "Мария", "Никита", "Софья", "Роман"];
const LAST_NAMES = ["Волкова", "Орлов", "Лебедева", "Ким", "Соколова", "Морозов", "Попова", "Новиков", "Кузнецова", "Фёдоров", "Белова", "Захаров"];
const COMPANY_ROOTS = ["Northstar", "Vertex", "Aurora", "Meridian", "Atlas", "Vector", "Nexa", "Orbit", "Bright", "Forma", "Pulse", "Craft"];
const COMPANY_SUFFIXES = ["Labs", "Group", "Digital", "Systems", "Works", "Partners"];
const CITIES = ["Москва", "Санкт-Петербург", "Казань", "Екатеринбург", "Новосибирск", "Самара"];

const CAMPAIGN_BLUEPRINTS = [
  { segment: "IT и разработка", name: "Знакомство с технологическими компаниями", audience: 286, sent: 264, delivered: 257, opened: 149, replied: 24, warm: 8 },
  { segment: "Профессиональные услуги", name: "Партнёрства с консалтингом", audience: 214, sent: 198, delivered: 193, opened: 106, replied: 17, warm: 5 },
  { segment: "E-commerce", name: "Рост исходящих продаж в e-commerce", audience: 318, sent: 301, delivered: 292, opened: 174, replied: 31, warm: 10 },
  { segment: "Производство", name: "Новые B2B-встречи для производства", audience: 247, sent: 226, delivered: 219, opened: 112, replied: 14, warm: 4 },
  { segment: "Недвижимость", name: "Пилот для команд недвижимости", audience: 176, sent: 151, delivered: 147, opened: 83, replied: 11, warm: 3 },
] as const;

function seededNumber(seed: string, modulo: number) {
  const value = createHash("sha256").update(seed).digest().readUInt32BE(0);
  return modulo > 0 ? value % modulo : 0;
}

function websiteLabel(url: string | null, fallback: string) {
  if (!url) return fallback;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const root = host.split(".")[0] || fallback;
    return root.slice(0, 1).toLocaleUpperCase("ru") + root.slice(1);
  } catch {
    return fallback;
  }
}

function fallbackProfile(companyName: string, websiteUrl: string | null): BusinessProfileData {
  return businessProfileDataSchema.parse({
    ...emptyBusinessProfile({ companyName, websiteUrl }),
    summary: `${companyName} помогает B2B-компаниям улучшать продажи и коммуникацию с клиентами. Это стартовый профиль демо — его можно уточнить в настройках.`,
    offers: ["Помощь B2B-компаниям в росте продаж и эффективности коммуникаций"],
    targetAudiences: ["Руководители и команды B2B-компаний"],
    painPoints: ["Нехватка предсказуемого потока новых диалогов", "Высокая стоимость ручной квалификации контактов"],
    differentiators: ["Персональный подход", "Понятный запуск и измеримый результат"],
    tone: "Деловой, спокойный, конкретный, без громких обещаний",
    unknowns: websiteUrl ? ["Часть данных сайта требует подтверждения владельцем"] : ["Сайт не указан — профиль заполнен стартовым сценарием"],
    sources: websiteUrl ? [{ url: websiteUrl, title: companyName }] : [],
  });
}

function contactRows(userId: string, seed: string) {
  return Array.from({ length: 900 }, (_, index) => {
    const segment = SEGMENTS[index % SEGMENTS.length];
    const first = FIRST_NAMES[(index + seededNumber(`${seed}:first`, FIRST_NAMES.length)) % FIRST_NAMES.length];
    const last = LAST_NAMES[(index * 5 + seededNumber(`${seed}:last`, LAST_NAMES.length)) % LAST_NAMES.length];
    const company = `${COMPANY_ROOTS[index % COMPANY_ROOTS.length]} ${COMPANY_SUFFIXES[(index * 3) % COMPANY_SUFFIXES.length]}`;
    const domain = `company-${String(index + 1).padStart(4, "0")}.demo.invalid`;
    return {
      userId,
      email: `contact-${String(index + 1).padStart(4, "0")}@${domain}`,
      name: `${first} ${last}`,
      company,
      segment: segment.name,
      isDemo: true,
      meta: {
        industry: segment.industry,
        position: segment.role,
        city: CITIES[index % CITIES.length],
        employees: [18, 35, 72, 120, 260, 540][index % 6],
        revenueBand: ["до 100 млн ₽", "100–500 млн ₽", "500 млн–2 млрд ₽"][index % 3],
        website: `https://${domain}`,
        source: "Демо-база",
      },
    };
  });
}

function outboundCopy(companyName: string, offer: string, recipient: string | null, company: string | null, segment: string) {
  return {
    subject: `${recipient ? `${recipient}, ` : ""}идея для ${company || "вашей команды"}`,
    body: `Здравствуйте${recipient ? `, ${recipient.split(" ")[0]}` : ""}!\n\nПосмотрел, как ${company || "ваша компания"} работает в сегменте «${segment}». ${companyName} предлагает: ${offer}. Хочу проверить, может ли это быть полезно вашей команде.\n\nБудет уместно коротко обсудить это на неделе?`,
  };
}

const INBOUND_REPLIES = [
  "Здравствуйте! Да, тема актуальна. Пришлите, пожалуйста, пару деталей и предложите время для короткого созвона.",
  "Добрый день. Интересно, но хотелось бы сначала понять стоимость пилота и сроки запуска.",
  "Спасибо за письмо. Сейчас не приоритет, вернитесь, пожалуйста, через месяц.",
  "Коллеги, благодарю. Мы уже решаем эту задачу внутри, поэтому пока откажемся.",
  "Можно подробнее про интеграцию с нашей CRM и как вы измеряете результат?",
];

type PopulateDemoWorkspaceInput = {
  organizationId: string;
  userId: string;
  organizationName: string;
  websiteUrl: string | null;
  sourceCrawlId?: string | null;
  preserveAnalyzedProfile?: boolean;
  preserveAccountSettings?: boolean;
};

async function populateDemoWorkspace(input: PopulateDemoWorkspaceInput, profile: BusinessProfileData) {
  const websiteUrl = profile.websiteUrl || input.websiteUrl;
  const companyName = profile.companyName || websiteLabel(websiteUrl, input.organizationName || "Ваша компания");
  const primaryOffer = (profile.offers[0] || "помочь B2B-командам улучшить продажи и коммуникацию с клиентами").replace(/[.!?]+$/, "").slice(0, 240);
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.campaign.deleteMany({ where: { userId: input.userId, isDemo: true } });
      await tx.contact.deleteMany({ where: { userId: input.userId, isDemo: true } });
      const demo = await tx.demoWorkspace.update({
        where: { organizationId: input.organizationId },
        data: { status: "GENERATING", websiteUrl, mailboxes: { deleteMany: {} } },
      });

      if (!input.preserveAccountSettings) {
        await tx.organization.update({ where: { id: input.organizationId }, data: { name: companyName } });
        await tx.user.update({
          where: { id: input.userId },
          data: {
            companyName,
            websiteUrl,
            offer: profile.offers.join("\n") || null,
            targetAudience: profile.targetAudiences.join("\n") || null,
          },
        });
        const storedProfile = await tx.organizationProfile.upsert({
          where: { organizationId: input.organizationId },
          create: {
            organizationId: input.organizationId,
            manualData: (input.preserveAnalyzedProfile ? emptyBusinessProfile({ companyName, websiteUrl }) : profile) as Prisma.InputJsonValue,
            draftData: profile as Prisma.InputJsonValue,
            publishedData: profile as Prisma.InputJsonValue,
            sourceCrawlId: input.sourceCrawlId ?? null,
            publishedSourceCrawlId: input.sourceCrawlId ?? null,
            publishedAt: now,
            staleAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
          },
          update: input.preserveAnalyzedProfile ? {
            draftData: profile as Prisma.InputJsonValue,
            publishedData: profile as Prisma.InputJsonValue,
            publishedSourceCrawlId: input.sourceCrawlId ?? undefined,
            publishedAt: now,
            staleAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
          } : {
            manualData: profile as Prisma.InputJsonValue,
            draftData: profile as Prisma.InputJsonValue,
            publishedData: profile as Prisma.InputJsonValue,
            publishedAt: now,
            staleAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
          },
        });
        if (input.preserveAnalyzedProfile) {
          const latestSnapshot = await tx.organizationProfileSnapshot.findFirst({
            where: { profileId: storedProfile.id },
            orderBy: { version: "desc" },
            select: { version: true },
          });
          await tx.organizationProfileSnapshot.create({
            data: {
              profileId: storedProfile.id,
              version: (latestSnapshot?.version ?? 0) + 1,
              data: profile as Prisma.InputJsonValue,
              createdById: input.userId,
            },
          });
        }
      }

      await tx.demoMailbox.createMany({
        data: ["anna", "maxim", "elena", "artem"].map((login, index) => ({
          demoWorkspaceId: demo.id,
          email: `${login}@outreach-${index < 2 ? "one" : "two"}.demo.invalid`,
          senderName: ["Анна Волкова", "Максим Орлов", "Елена Соколова", "Артём Ким"][index],
          domain: `outreach-${index < 2 ? "one" : "two"}.demo.invalid`,
          warmupDay: 14,
          healthScore: [98, 100, 96, 99][index],
          coldSentToday: [18, 21, 16, 19][index],
        })),
      });

      await tx.contact.createMany({ data: contactRows(input.userId, input.organizationId) });
      const contacts = await tx.contact.findMany({
        where: { userId: input.userId, isDemo: true },
        orderBy: { email: "asc" },
      });

      for (let campaignIndex = 0; campaignIndex < CAMPAIGN_BLUEPRINTS.length; campaignIndex++) {
        const blueprint = CAMPAIGN_BLUEPRINTS[campaignIndex];
        const examples = 5 + (campaignIndex % 3);
        const stats: DemoCampaignStats = {
          audience: blueprint.audience,
          sent: blueprint.sent,
          delivered: blueprint.delivered,
          opened: blueprint.opened,
          replied: blueprint.replied,
          warm: blueprint.warm,
          generatedExamples: examples,
          replyExamples: Math.min(4, 2 + (campaignIndex % 3)),
        };
        const campaign = await tx.campaign.create({
          data: {
            userId: input.userId,
            createdById: input.userId,
            name: blueprint.name,
            subject: `Идея для {{company}} от ${companyName}`,
            body: `Здравствуйте, {{name}}! ${companyName} предлагает: ${primaryOffer}. Хочу обсудить, может ли это быть полезно {{company}}.`,
            segment: blueprint.segment,
            status: "SENT",
            startedAt: new Date(now.getTime() - (campaignIndex + 2) * 86_400_000),
            trackingEnabled: true,
            followupEnabled: true,
            isDemo: true,
            demoAudienceSize: stats.audience,
            demoGeneratedCount: stats.generatedExamples,
            demoStats: stats as unknown as Prisma.InputJsonValue,
            followupSteps: {
              create: [
                { stepNumber: 1, daysAfterPrevious: 3, subject: "Re: {{company}}", body: "Подниму письмо — возможно, тема актуальна для вашей команды?" },
                { stepNumber: 2, daysAfterPrevious: 5, subject: "Re: {{company}}", body: "Если сейчас не вовремя, подскажите, когда лучше вернуться к вопросу." },
              ],
            },
          },
        });

        const segmentContacts = contacts.filter((contact) => contact.segment === blueprint.segment).slice(campaignIndex * examples, campaignIndex * examples + examples);
        for (let index = 0; index < segmentContacts.length; index++) {
          const contact = segmentContacts[index];
          const copy = outboundCopy(companyName, primaryOffer, contact.name, contact.company, blueprint.segment);
          const hasReply = index < stats.replyExamples;
          const sentAt = new Date(now.getTime() - (campaignIndex + 1) * 86_400_000 - index * 3_600_000);
          const message = await tx.message.create({
            data: {
              campaignId: campaign.id,
              contactId: contact.id,
              subject: copy.subject,
              body: copy.body,
              status: hasReply ? "REPLIED" : index % 2 ? "OPENED" : "DELIVERED",
              sentAt,
              deliveredAt: new Date(sentAt.getTime() + 40_000),
              openedAt: index % 2 || hasReply ? new Date(sentAt.getTime() + 3_600_000) : null,
              repliedAt: hasReply ? new Date(sentAt.getTime() + 8_000_000) : null,
              aiRepliesEnabled: index % 4 !== 3,
            },
          });
          if (hasReply) {
            const inbound = INBOUND_REPLIES[(campaignIndex + index) % INBOUND_REPLIES.length];
            await tx.replyMessage.create({
              data: {
                messageId: message.id,
                direction: "inbound",
                subject: `Re: ${copy.subject}`,
                fromEmail: contact.email,
                body: inbound,
                status: "SENT",
                createdAt: new Date(sentAt.getTime() + 8_000_000),
              },
            });
            const hot = index < Math.min(2, stats.replyExamples) && !inbound.includes("откажемся");
            await tx.lead.create({
              data: {
                userId: input.userId,
                messageId: message.id,
                qualification: hot ? "HOT" : inbound.includes("откажемся") ? "IRRELEVANT" : "UNKNOWN",
                summary: hot
                  ? `${contact.name} заинтересован(а), уточняет детали и готов(а) продолжить разговор.`
                  : `${contact.name} ответил(а) на письмо; требуется короткая ручная проверка намерения.`,
              },
            });
            if (!inbound.includes("откажемся")) {
              await tx.replyMessage.create({
                data: {
                  messageId: message.id,
                  direction: "outbound",
                  subject: `Re: ${copy.subject}`,
                  fromEmail: "demo@smailee.invalid",
                  toEmail: contact.email,
                  body: hot
                    ? "Спасибо за ответ! Предлагаю короткий созвон на 20 минут. Подойдёт завтра после 15:00?"
                    : "Спасибо, понял. Подскажите, когда будет уместно вернуться к этому вопросу?",
                  isAi: true,
                  status: "DRAFT",
                  createdAt: new Date(sentAt.getTime() + 8_100_000),
                },
              });
            }
          }
        }
      }

      await tx.demoWorkspace.update({
        where: { id: demo.id },
        data: {
          status: "ACTIVE",
          initializedAt: now,
          disabledAt: null,
          lastError: null,
          scenario: {
            version: 2,
            persistent: true,
            companyName,
            contacts: 900,
            campaigns: CAMPAIGN_BLUEPRINTS.length,
            generatedExamplesPerCampaign: "5–7",
          } as Prisma.InputJsonValue,
        },
      });
    }, { timeout: 60_000 });
  } catch (error) {
    await prisma.demoWorkspace.update({
      where: { organizationId: input.organizationId },
      data: { status: "FAILED", lastError: error instanceof Error ? error.message.slice(0, 1000) : "Не удалось собрать демо" },
    });
    throw error;
  }
}

/** Быстрый сценарий без сайта: полноценному анализу нечего обходить. */
export async function provisionDemoWorkspace(input: { organizationId: string; userId: string; organizationName: string; websiteUrl?: string | null }) {
  const websiteUrl = input.websiteUrl?.trim() || null;
  const companyName = websiteLabel(websiteUrl, input.organizationName || "Ваша компания");
  await prisma.demoWorkspace.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      status: "GENERATING",
      websiteUrl,
    },
    update: { status: "GENERATING", websiteUrl, initializedAt: null, lastError: null },
  });
  return populateDemoWorkspace(
    { ...input, websiteUrl, preserveAnalyzedProfile: false },
    fallbackProfile(companyName, websiteUrl),
  );
}

export type ActivateDemoWorkspaceResult = "active" | "generated" | "generating" | "needs_setup";

/**
 * Включает уже созданную песочницу без повторной генерации. Для старых
 * одноразовых сценариев или первого запуска строит её один раз из текущего
 * опубликованного профиля, не меняя рабочие настройки организации.
 */
export async function activateDemoWorkspace(input: { organizationId: string; userId: string; organizationName: string }): Promise<ActivateDemoWorkspaceResult> {
  const demo = await prisma.demoWorkspace.upsert({
    where: { organizationId: input.organizationId },
    create: { organizationId: input.organizationId, status: "PENDING" },
    update: {},
  });
  if (demo.status === "ACTIVE") return "active";
  if (demo.status === "GENERATING") return "generating";
  if (isPersistentDemoScenario(demo.scenario)) {
    await prisma.demoWorkspace.update({
      where: { id: demo.id },
      data: { status: "ACTIVE", disabledAt: null, lastError: null },
    });
    return "active";
  }

  const storedProfile = await prisma.organizationProfile.findUnique({
    where: { organizationId: input.organizationId },
    select: { publishedData: true, publishedSourceCrawlId: true },
  });
  if (!storedProfile?.publishedData) {
    await prisma.demoWorkspace.update({
      where: { id: demo.id },
      data: { status: "PENDING", initializedAt: null, disabledAt: null, lastError: null },
    });
    return "needs_setup";
  }

  const profile = parseBusinessProfile(storedProfile.publishedData, fallbackProfile(input.organizationName, null));
  await populateDemoWorkspace({
    ...input,
    websiteUrl: profile.websiteUrl,
    sourceCrawlId: storedProfile.publishedSourceCrawlId,
    preserveAnalyzedProfile: false,
    preserveAccountSettings: true,
  }, profile);
  return "generated";
}

/** Завершает демо только после штатного production-пайплайна Firecrawl → DeepSeek. */
export async function processGeneratingDemoWorkspaces(organizationId?: string) {
  const demos = await prisma.demoWorkspace.findMany({
    where: { status: "GENERATING", ...(organizationId ? { organizationId } : {}) },
    include: { organization: { include: { owner: true } } },
    orderBy: { updatedAt: "asc" },
    take: organizationId ? 1 : 3,
  });
  let completed = 0;
  for (const demo of demos) {
    const crawl = await prisma.websiteCrawl.findFirst({
      where: { organizationId: demo.organizationId },
      orderBy: { createdAt: "desc" },
      select: { id: true, rootUrl: true, status: true, profileData: true, error: true },
    });
    if (!crawl) continue;
    if (crawl.status === "FAILED" || crawl.status === "CANCELED") {
      await prisma.demoWorkspace.update({
        where: { id: demo.id },
        data: { status: "FAILED", initializedAt: null, lastError: crawl.error || "Анализ сайта остановлен" },
      });
      continue;
    }
    if (crawl.status !== "READY_FOR_REVIEW" || !crawl.profileData) continue;

    const claimTime = new Date();
    const claimed = await prisma.demoWorkspace.updateMany({
      where: {
        id: demo.id,
        status: "GENERATING",
        OR: [{ initializedAt: null }, { initializedAt: { lt: new Date(claimTime.getTime() - 10 * 60_000) } }],
      },
      data: { initializedAt: claimTime, lastError: null },
    });
    if (!claimed.count) continue;

    const profile = parseBusinessProfile(crawl.profileData, fallbackProfile(demo.organization.name, crawl.rootUrl));
    await populateDemoWorkspace({
      organizationId: demo.organizationId,
      userId: demo.organization.owner.id,
      organizationName: demo.organization.name,
      websiteUrl: crawl.rootUrl,
      sourceCrawlId: crawl.id,
      preserveAnalyzedProfile: true,
    }, profile);
    completed += 1;
  }
  return completed;
}

export async function simulateDemoCampaign(campaignId: string, userId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId, isDemo: true },
    include: { messages: { include: { contact: true, thread: true, lead: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!campaign) return false;
  if (campaign.status === "SENT") return true;
  const audience = campaign.demoAudienceSize ?? campaign.messages.length;
  const sent = Math.max(0, Math.round(audience * 0.92));
  const delivered = Math.round(sent * 0.97);
  const opened = campaign.trackingEnabled ? Math.round(delivered * 0.56) : 0;
  const replied = Math.max(1, Math.round(delivered * 0.075));
  const warm = Math.max(1, Math.round(replied * 0.32));
  const replyExamples = Math.min(3, Math.max(1, Math.round(audience / 180)), campaign.messages.length);
  const replyMessageIds = new Set(
    [...campaign.messages]
      .sort(
        (left, right) =>
          seededNumber(`${campaign.id}:reply-contact:${left.id}`, 1_000_000) -
          seededNumber(`${campaign.id}:reply-contact:${right.id}`, 1_000_000),
      )
      .slice(0, replyExamples)
      .map((message) => message.id),
  );
  const replyTypeOffset = seededNumber(`${campaign.id}:reply-type`, INBOUND_REPLIES.length);
  let replyIndex = 0;
  const stats: DemoCampaignStats = {
    audience,
    sent,
    delivered,
    opened,
    replied,
    warm,
    generatedExamples: campaign.messages.length,
    replyExamples,
  };
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: campaign.id },
      data: { status: "SENT", startedAt: now, demoStats: stats as unknown as Prisma.InputJsonValue },
    });
    for (let index = 0; index < campaign.messages.length; index++) {
      const message = campaign.messages[index];
      const hasReply = replyMessageIds.has(message.id);
      const sentAt = new Date(now.getTime() - (campaign.messages.length - index) * 60_000);
      await tx.message.update({
        where: { id: message.id },
        data: {
          status: hasReply ? "REPLIED" : index % 2 ? "OPENED" : "DELIVERED",
          sentAt,
          deliveredAt: new Date(sentAt.getTime() + 20_000),
          openedAt: hasReply || index % 2 ? new Date(sentAt.getTime() + 45_000) : null,
          repliedAt: hasReply ? new Date(sentAt.getTime() + 90_000) : null,
        },
      });
      if (hasReply && !message.thread.some((reply) => reply.direction === "inbound")) {
        const body = INBOUND_REPLIES[(replyTypeOffset + replyIndex) % INBOUND_REPLIES.length];
        const refused = body.includes("откажемся");
        const hot = !refused && (replyIndex === 0 || body.includes("стоимость") || body.includes("интеграцию"));
        replyIndex += 1;
        await tx.replyMessage.create({
          data: { messageId: message.id, direction: "inbound", subject: `Re: ${message.subject}`, fromEmail: message.contact.email, body, status: "SENT", createdAt: new Date(sentAt.getTime() + 90_000) },
        });
        await tx.lead.upsert({
          where: { messageId: message.id },
          create: {
            userId,
            messageId: message.id,
            qualification: refused ? "IRRELEVANT" : hot ? "HOT" : "UNKNOWN",
            summary: refused
              ? "Контакт вежливо отказался от предложения."
              : hot
                ? "Контакт заинтересован и просит продолжить предметный диалог."
                : "Контакт ответил; требуется оценить следующий шаг.",
          },
          update: {
            qualification: refused ? "IRRELEVANT" : hot ? "HOT" : "UNKNOWN",
            summary: refused
              ? "Контакт вежливо отказался от предложения."
              : hot
                ? "Контакт заинтересован и просит продолжить предметный диалог."
                : "Контакт ответил; требуется оценить следующий шаг.",
          },
        });
        if (!refused) {
          await tx.replyMessage.create({
            data: { messageId: message.id, direction: "outbound", subject: `Re: ${message.subject}`, body: hot ? "Спасибо! Предлагаю короткий созвон — когда вам удобно на этой неделе?" : "Спасибо за ответ. Подскажите, когда лучше вернуться к теме?", isAi: true, status: "DRAFT", createdAt: new Date(sentAt.getTime() + 95_000) },
          });
        }
      }
    }
  });
  return true;
}

export async function disableDemoWorkspace(organizationId: string, _userId: string) {
  const demo = await prisma.demoWorkspace.findUnique({ where: { organizationId }, select: { status: true } });
  if (!demo || demo.status !== "ACTIVE") return;
  await prisma.demoWorkspace.update({
    where: { organizationId },
    data: { status: "DISABLED", disabledAt: new Date() },
  });
}
