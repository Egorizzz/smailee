import { suiteHeader, test, assert, makeUser, prisma } from "../harness";
import { getBusinessContext, getPublishedBusinessProfile, isBusinessProfileReady } from "@/lib/businessProfile/context";

export default async function businessProfileSuite() {
  suiteHeader("Профиль организации и поиск по сайту");

  await test("опубликованный профиль дополняет ответ релевантным фрагментом и скрывает неподтверждённую цену", async () => {
    const user = await makeUser({
      companyName: "Устаревшее название",
      offer: "Старый оффер владельца",
      targetAudience: "Старая аудитория владельца",
    });
    const organization = await prisma.organization.create({
      data: { name: "Интегратор", ownerId: user.id, members: { connect: { id: user.id } } },
    });
    const profileData = {
      schemaVersion: 1,
      companyName: "Интегратор",
      websiteUrl: "https://example.test/",
      summary: "Интеграция учётных систем",
      offers: ["Внедряем интеграции без остановки продаж"],
      products: [{ name: "Интеграция с 1С", description: "Обмен заказами", pricing: "от 100 000 ₽", pricingConfirmed: false, sourceUrl: "https://example.test/1c" }],
      targetAudiences: ["Оптовые компании"],
      painPoints: [], differentiators: [], proof: [], geography: [], salesProcess: [], restrictions: [], tone: "", manualNotes: "", unknowns: [], sources: [],
    };
    await prisma.organizationProfile.create({
      data: { organizationId: organization.id, draftData: profileData, publishedData: profileData, publishedAt: new Date(), staleAt: new Date(Date.now() + 86_400_000) },
    });
    const crawl = await prisma.websiteCrawl.create({
      data: { organizationId: organization.id, createdById: user.id, rootUrl: "https://example.test/", status: "READY_FOR_REVIEW" },
    });
    await prisma.organizationProfile.update({ where: { organizationId: organization.id }, data: { sourceCrawlId: crawl.id, publishedSourceCrawlId: crawl.id } });
    await prisma.websitePage.create({
      data: {
        crawlId: crawl.id,
        url: "https://example.test/1c",
        canonicalUrl: "https://example.test/1c",
        title: "Интеграция с 1С",
        markdown: "Настраиваем двустороннюю интеграцию с 1С: заказы, остатки и статусы отгрузки.",
        contentHash: "hash",
        analysisStatus: "DONE",
      },
    });

    const context = await getBusinessContext(user, "Есть интеграция с 1С и обмен заказами?");
    assert.match(context.promptContext, /Интеграция с 1С/);
    assert.match(context.promptContext, /остатки/);
    assert.doesNotMatch(context.promptContext, /100 000/);
    assert.doesNotMatch(context.promptContext, /Старый оффер владельца/);
    assert.equal(context.offer, "Внедряем интеграции без остановки продаж");
    assert.equal(context.targetAudience, "Оптовые компании");

    const published = await getPublishedBusinessProfile(user);
    assert.equal(published.published, true);
    assert.equal(isBusinessProfileReady(published.profile), true);
  });
}
