import { provisionDemoClient } from "@/server/accountProvisioning";
import { Prisma } from "@prisma/client";
import { emptyBusinessProfile, parseBusinessProfile } from "@/lib/businessProfile/types";
import { activateDemoWorkspace, disableDemoWorkspace, processGeneratingDemoWorkspaces, provisionDemoWorkspace, simulateDemoCampaign } from "@/server/demoWorkspace";
import { processCampaign } from "@/server/sendEngine";
import { assert, prisma, suiteHeader, test } from "../harness";

export default async function demoWorkspaceSuite() {
  suiteHeader("demo workspace — изоляция песочницы");

  await test("создаёт компактные примеры, симулирует ответы и не отправляет их через SMTP", async () => {
    const user = await provisionDemoClient({
      email: "demo-owner@example.test",
      name: "Демо",
      companyName: "Демо Компания",
      initialPassword: "Demo-Password9!",
    });
    await provisionDemoWorkspace({
      organizationId: user.organizationId!,
      userId: user.id,
      organizationName: "Демо Компания",
      websiteUrl: null,
    });

    const demo = await prisma.demoWorkspace.findUniqueOrThrow({
      where: { organizationId: user.organizationId! },
      include: { mailboxes: true },
    });
    const campaigns = await prisma.campaign.findMany({ where: { userId: user.id, isDemo: true }, include: { _count: { select: { messages: true } } } });
    assert.equal(demo.status, "ACTIVE");
    assert.equal(demo.mailboxes.length, 4);
    assert.equal(await prisma.contact.count({ where: { userId: user.id, isDemo: true } }), 900);
    assert.equal(campaigns.length, 5);
    assert.ok(campaigns.every((campaign) => campaign._count.messages >= 5 && campaign._count.messages <= 7));
    assert.ok(demo.mailboxes.every((mailbox) => mailbox.email.endsWith(".demo.invalid")));

    const contacts = await prisma.contact.findMany({ where: { userId: user.id, isDemo: true }, take: 7 });
    assert.equal(contacts.length, 7);
    const customCampaign = await prisma.campaign.create({
      data: {
        userId: user.id,
        createdById: user.id,
        name: "Пользовательская демо-кампания",
        subject: "Демо",
        body: "Демо",
        status: "QUEUED",
        isDemo: true,
        demoAudienceSize: 300,
        demoGeneratedCount: contacts.length,
        messages: {
          create: contacts.map((contact, index) => ({
            contactId: contact.id,
            subject: `Демо ${index + 1}`,
            body: "Демо",
            status: "PENDING",
          })),
        },
      },
    });
    const blocked = await processCampaign(customCampaign.id);
    assert.deepEqual(blocked, { sent: 0, failed: 0, skipped: 0, remaining: 0 });
    assert.equal((await prisma.message.findFirstOrThrow({ where: { campaignId: customCampaign.id } })).status, "PENDING");

    await simulateDemoCampaign(customCampaign.id, user.id);
    const simulated = await prisma.campaign.findUniqueOrThrow({ where: { id: customCampaign.id }, include: { messages: { include: { thread: true } } } });
    assert.equal(simulated.status, "SENT");
    const inboundReplies = simulated.messages.flatMap((message) => message.thread.filter((reply) => reply.direction === "inbound"));
    assert.ok(inboundReplies.length >= 1 && inboundReplies.length <= 3);
    assert.equal(new Set(inboundReplies.map((reply) => reply.body)).size, inboundReplies.length);
    assert.ok(simulated.messages.some((message) => message.thread.some((reply) => reply.direction === "outbound" && reply.isAi && reply.status === "DRAFT")));

    const demoContactIds = (await prisma.contact.findMany({ where: { userId: user.id, isDemo: true }, select: { id: true }, orderBy: { id: "asc" } })).map((item) => item.id);
    const demoCampaignIds = (await prisma.campaign.findMany({ where: { userId: user.id, isDemo: true }, select: { id: true }, orderBy: { id: "asc" } })).map((item) => item.id);
    const domain = await prisma.domainGroup.create({ data: { userId: user.id, domain: "real-workspace.test" } });
    const realMailbox = await prisma.mailbox.create({
      data: {
        userId: user.id,
        email: "sender@real-workspace.test",
        senderName: "Рабочий отправитель",
        smtpHost: "smtp.real-workspace.test",
        smtpPort: 465,
        smtpLogin: "sender@real-workspace.test",
        imapHost: "imap.real-workspace.test",
        imapPort: 993,
        imapLogin: "sender@real-workspace.test",
        smtpPasswordEnc: "encrypted",
        imapPasswordEnc: "encrypted",
        domainGroupId: domain.id,
        connState: "ok",
        warmupState: "warming",
        warmupDay: 6,
        warmupStartedAt: new Date("2026-08-01T09:00:00.000Z"),
      },
    });
    const realContact = await prisma.contact.create({ data: { userId: user.id, email: "real-contact@example.test", isDemo: false } });
    const realCampaign = await prisma.campaign.create({
      data: { userId: user.id, createdById: user.id, name: "Рабочая кампания", subject: "Рабочая", body: "Рабочая", isDemo: false },
    });
    const settingsBefore = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { setupClosedAt: true, aiModerationEnabled: true, autoPingEnabled: true },
    });

    await disableDemoWorkspace(user.organizationId!, user.id);
    const disabled = await prisma.demoWorkspace.findUniqueOrThrow({ where: { organizationId: user.organizationId! }, include: { mailboxes: true } });
    assert.equal(disabled.status, "DISABLED");
    assert.equal(disabled.mailboxes.length, 4);
    assert.deepEqual((await prisma.contact.findMany({ where: { userId: user.id, isDemo: true }, select: { id: true }, orderBy: { id: "asc" } })).map((item) => item.id), demoContactIds);
    assert.deepEqual((await prisma.campaign.findMany({ where: { userId: user.id, isDemo: true }, select: { id: true }, orderBy: { id: "asc" } })).map((item) => item.id), demoCampaignIds);
    assert.ok(await prisma.contact.findUnique({ where: { id: realContact.id } }));
    assert.ok(await prisma.campaign.findUnique({ where: { id: realCampaign.id } }));
    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { setupClosedAt: true, aiModerationEnabled: true, autoPingEnabled: true } }), settingsBefore);
    assert.deepEqual(await prisma.mailbox.findUniqueOrThrow({ where: { id: realMailbox.id }, select: { warmupState: true, warmupDay: true, connState: true } }), { warmupState: "warming", warmupDay: 6, connState: "ok" });
    assert.ok((await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId: user.organizationId! } })).publishedData);

    assert.equal(await activateDemoWorkspace({ organizationId: user.organizationId!, userId: user.id, organizationName: "Демо Компания" }), "active");
    const reactivated = await prisma.demoWorkspace.findUniqueOrThrow({ where: { organizationId: user.organizationId! } });
    assert.equal(reactivated.status, "ACTIVE");
    assert.deepEqual((await prisma.contact.findMany({ where: { userId: user.id, isDemo: true }, select: { id: true }, orderBy: { id: "asc" } })).map((item) => item.id), demoContactIds);
    assert.deepEqual((await prisma.campaign.findMany({ where: { userId: user.id, isDemo: true }, select: { id: true }, orderBy: { id: "asc" } })).map((item) => item.id), demoCampaignIds);
  });

  await test("строит демо из результата рабочего анализа и сохраняет профиль после отключения", async () => {
    const user = await provisionDemoClient({
      email: "demo-production-profile@example.test",
      name: "Рабочий анализ",
      companyName: "Компания до анализа",
      initialPassword: "Demo-Password9!",
    });
    const organizationId = user.organizationId!;
    const manual = { ...emptyBusinessProfile({ companyName: "Компания до анализа" }), manualNotes: "Ручное примечание администратора" };
    const analyzed = {
      ...emptyBusinessProfile({ companyName: "Полная Компания", websiteUrl: "https://full-profile.example/" }),
      summary: "Полный профиль, собранный рабочим конвейером анализа сайта.",
      offers: ["Платформа автоматизации продаж"],
      products: [{ name: "Enterprise", description: "Автоматизация для отделов продаж", pricing: "По запросу", pricingConfirmed: false, sourceUrl: "https://full-profile.example/products/" }],
      targetAudiences: ["Руководители B2B-продаж"],
      painPoints: ["Ручная обработка большого числа контактов"],
      differentiators: ["Единый процесс от базы до диалога"],
      proof: ["Опубликованные клиентские кейсы"],
      geography: ["Россия"],
      salesProcess: ["Демонстрация и пилот"],
      tone: "Деловой и конкретный",
      sources: [{ url: "https://full-profile.example/products/", title: "Продукты" }],
    };
    await prisma.organizationProfile.update({
      where: { organizationId },
      data: { manualData: manual as Prisma.InputJsonValue, draftData: analyzed as Prisma.InputJsonValue },
    });
    const crawl = await prisma.websiteCrawl.create({
      data: {
        organizationId,
        createdById: user.id,
        rootUrl: "https://full-profile.example/",
        status: "READY_FOR_REVIEW",
        profileData: analyzed as Prisma.InputJsonValue,
        profileVersion: 1,
      },
    });
    await prisma.demoWorkspace.update({
      where: { organizationId },
      data: { status: "GENERATING", websiteUrl: crawl.rootUrl, initializedAt: null },
    });

    assert.equal(await processGeneratingDemoWorkspaces(organizationId), 1);
    const profile = await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId } });
    assert.equal((parseBusinessProfile(profile.manualData)).manualNotes, "Ручное примечание администратора");
    assert.equal((parseBusinessProfile(profile.publishedData)).products.length, 1);
    assert.equal(profile.publishedSourceCrawlId, crawl.id);
    assert.equal(await prisma.organizationProfileSnapshot.count({ where: { profileId: profile.id } }), 1);
    assert.equal((await prisma.demoWorkspace.findUniqueOrThrow({ where: { organizationId } })).status, "ACTIVE");

    await disableDemoWorkspace(organizationId, user.id);
    assert.equal((parseBusinessProfile((await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId } })).publishedData)).offers[0], "Платформа автоматизации продаж");
  });

  await test("первое включение из настроек использует рабочий профиль, не меняя настройки аккаунта", async () => {
    const user = await provisionDemoClient({
      email: "demo-existing-account@example.test",
      name: "Владелец",
      companyName: "Рабочая компания",
      initialPassword: "Demo-Password9!",
    });
    const organizationId = user.organizationId!;
    const setupClosedAt = new Date("2026-07-15T09:00:00.000Z");
    const published = {
      ...emptyBusinessProfile({ companyName: "Рабочая компания", websiteUrl: "https://working-company.example/" }),
      summary: "Подтверждённый рабочий профиль компании.",
      offers: ["Рабочий продукт"],
      targetAudiences: ["Команды продаж"],
      painPoints: ["Ручная работа"],
      differentiators: ["Быстрый запуск"],
    };
    await prisma.user.update({
      where: { id: user.id },
      data: { setupClosedAt, aiModerationEnabled: false, autoPingEnabled: true, autoPingIntervalDays: 11 },
    });
    await prisma.organizationProfile.update({
      where: { organizationId },
      data: { publishedData: published as Prisma.InputJsonValue, publishedAt: new Date() },
    });
    await prisma.demoWorkspace.update({ where: { organizationId }, data: { status: "DISABLED" } });
    const settingsBefore = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { companyName: true, setupClosedAt: true, aiModerationEnabled: true, autoPingEnabled: true, autoPingIntervalDays: true },
    });
    const profileBefore = await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId } });

    assert.equal(await activateDemoWorkspace({ organizationId, userId: user.id, organizationName: "Рабочая компания" }), "generated");
    assert.deepEqual(await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { companyName: true, setupClosedAt: true, aiModerationEnabled: true, autoPingEnabled: true, autoPingIntervalDays: true },
    }), settingsBefore);
    const profileAfter = await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId } });
    assert.deepEqual(profileAfter.manualData, profileBefore.manualData);
    assert.deepEqual(profileAfter.publishedData, profileBefore.publishedData);
    assert.equal((await prisma.demoWorkspace.findUniqueOrThrow({ where: { organizationId } })).status, "ACTIVE");
    assert.equal(await prisma.contact.count({ where: { userId: user.id, isDemo: true } }), 900);
    assert.equal(await prisma.campaign.count({ where: { userId: user.id, isDemo: true } }), 5);
  });
}
