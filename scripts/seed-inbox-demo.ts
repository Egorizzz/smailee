import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const DEMO_CAMPAIGNS = ["UX • Inbox demo", "UX • Analytics demo"] as const;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL не задан");
const host = new URL(databaseUrl).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  throw new Error(`Seed разрешён только для локальной БД. Получен host: ${host}`);
}

async function main() {
const { prisma } = await import("../src/lib/prisma");
const admin = await prisma.user.findUnique({ where: { email: "admin@smailee.ru" } });
if (!admin) throw new Error("Локальный пользователь admin@smailee.ru не найден");

await prisma.campaign.deleteMany({ where: { userId: admin.id, name: { in: [...DEMO_CAMPAIGNS] } } });

const now = Date.now();
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000);
const inboxCampaign = await prisma.campaign.create({ data: {
  userId: admin.id,
  createdById: admin.id,
  name: DEMO_CAMPAIGNS[0],
  subject: "Знакомство со Smailee",
  body: "Здравствуйте! Предлагаю обсудить автоматизацию исходящих коммуникаций.",
  status: "SENT",
  startedAt: hoursAgo(72),
  trackingEnabled: true,
  segment: "SaaS",
  followupEnabled: true,
  followupSteps: { create: [
    { stepNumber: 1, daysAfterPrevious: 3, subject: "Re: Знакомство со Smailee", body: "Коротко напомню о предложении — актуально обсудить?" },
    { stepNumber: 2, daysAfterPrevious: 5, subject: "Re: Знакомство со Smailee", body: "Если сейчас не ко времени, подскажите, когда лучше вернуться." },
  ] },
} });
const analyticsCampaign = await prisma.campaign.create({ data: { userId: admin.id, createdById: admin.id, name: DEMO_CAMPAIGNS[1], subject: "Идея для отдела продаж", body: "Здравствуйте! Есть идея, как разгрузить команду продаж.", status: "SENT", startedAt: hoursAgo(120), trackingEnabled: false, segment: "B2B" } });

const scenarios = [
  { email: "anna@northstar.demo", name: "Анна Волкова", company: "Northstar", segment: "SaaS", campaignId: inboxCampaign.id, qualification: "HOT" as const, summary: "Анна заинтересована и просит созвон сегодня после 16:00.", inbound: "Здравствуйте! Да, это актуально. Давайте созвонимся сегодня после 16:00 — расскажите, как проходит запуск.", age: 1 },
  { email: "maxim@vector.demo", name: "Максим Орлов", company: "Vector", segment: "B2B", campaignId: analyticsCampaign.id, qualification: "COLD" as const, summary: "Уточняет стоимость и условия пилота.", inbound: "Добрый день. Пока просто сравниваем решения. Сколько стоит пилот на 500 контактов?", age: 3 },
  { email: "irina@atlas.demo", name: "Ирина Лебедева", company: "Atlas", segment: "SaaS", campaignId: inboxCampaign.id, qualification: "HOT" as const, summary: "Готова посмотреть демо; ответ ИИ ждёт проверки.", inbound: "Интересно. Можете показать демо в четверг утром?", draft: "Ирина, здравствуйте! Да, в четверг утром удобно. Подойдёт 11:00 по Москве?", age: 5 },
  { email: "pavel@orbit.demo", name: "Павел Морозов", company: "Orbit", segment: "B2B", campaignId: analyticsCampaign.id, qualification: "COLD" as const, summary: "Получил ответ с материалами.", inbound: "Пришлите, пожалуйста, короткую презентацию на почту.", sentReply: "Павел, здравствуйте! Отправляю краткое описание. Если появятся вопросы, отвечу здесь.", age: 20 },
  { email: "maria@pulse.demo", name: "Мария Соколова", company: "Pulse", segment: "SaaS", campaignId: inboxCampaign.id, qualification: "HOT" as const, summary: "Запрос передан менеджеру и вручную обработан.", inbound: "Готовы запускаться. Нужен договор и счёт на этой неделе.", processed: true, age: 26 },
  { email: "oleg@craft.demo", name: "Олег Романов", company: "Craft", segment: "B2B", campaignId: analyticsCampaign.id, qualification: "HOT" as const, summary: "Лид уже передан в CRM.", inbound: "Коллеги, свяжите меня с менеджером по внедрению.", processed: true, pushed: true, age: 32 },
  { email: "support@random.demo", name: "Служба поддержки", company: "Random", segment: null, campaignId: inboxCampaign.id, qualification: "IRRELEVANT" as const, summary: "Автоматический ответ, не относится к продаже.", inbound: "Ваше обращение зарегистрировано под номером 4821.", age: 40 },
  { email: "denis@brook.demo", name: "Денис Крылов", company: "Brook", segment: "SaaS", campaignId: inboxCampaign.id, qualification: "UNKNOWN" as const, summary: "Ответ неоднозначный — требуется оценка оператора.", inbound: "Добрый день. Вернусь с ответом после планёрки.", age: 48 },
  { email: "roman@ice.demo", name: "Роман Беляев", company: "Iceberg", segment: "B2B", campaignId: inboxCampaign.id, qualification: "COLD" as const, summary: "Получил расчёт, после нашего ответа молчит больше недели.", inbound: "Пришлите расчёт на 2 000 контактов, посмотрю.", sentReply: "Роман, отправляю расчёт. Подскажите, какие параметры для вас важнее всего?", age: 240 },
  { email: "elena@winter.demo", name: "Елена Жукова", company: "Winter", segment: "SaaS", campaignId: analyticsCampaign.id, qualification: "HOT" as const, summary: "Интересовалась пилотом, последнее сообщение осталось без ответа.", inbound: "Готова обсудить пилот, какие следующие шаги?", sentReply: "Елена, предлагаю короткий созвон и затем настройку тестовой кампании. Когда вам удобно?", age: 260 },
  { email: "artem@snow.demo", name: "Артём Ким", company: "Snow", segment: "B2B", campaignId: inboxCampaign.id, qualification: "COLD" as const, summary: "Уточнил детали интеграции и перестал отвечать.", inbound: "У вас есть интеграция с нашей CRM?", sentReply: "Артём, да, интеграцию можно настроить через API. Какая CRM используется у вас?", age: 280 },
  { email: "sofia@north.demo", name: "София Ершова", company: "North", segment: "SaaS", campaignId: analyticsCampaign.id, qualification: "HOT" as const, summary: "Просила условия запуска, после ответа прошло больше недели.", inbound: "Какие условия запуска на стандартном тарифе?", sentReply: "София, отправил основные условия. Хотите, помогу подобрать объём первой кампании?", age: 300 },
  { email: "viktor@manual.demo", name: "Виктор Сазонов", company: "Manual", segment: "B2B", campaignId: inboxCampaign.id, qualification: "HOT" as const, summary: "Диалог ведётся менеджером вручную; автоответы ИИ отключены.", inbound: "Давайте дальше общаться напрямую с менеджером.", sentReply: "Виктор, договорились. Я продолжу переписку лично.", manual: true, age: 30 },
  { email: "alex@decline.demo", name: "Алексей Фомин", company: "Decline", segment: "B2B", campaignId: analyticsCampaign.id, qualification: "COLD" as const, summary: "ИИ распознал коммерческий отказ, требуется подтверждение.", inbound: "Спасибо, но сейчас предложение нам неинтересно.", refusalSuggested: true, age: 8 },
  { email: "olga@stop.demo", name: "Ольга Миронова", company: "Stop", segment: "SaaS", campaignId: inboxCampaign.id, qualification: "IRRELEVANT" as const, summary: "Контакт отказался от продолжения коммуникации.", inbound: "Не актуально, пожалуйста, больше не связывайтесь со мной.", refused: true, age: 12 },
] as const;

const GENERATED_AI_DRAFTS: Record<string, string> = {
  "anna@northstar.demo": "Анна, здравствуйте! Да, давайте созвонимся. Подойдёт сегодня в 16:30 по Москве?",
  "maxim@vector.demo": "Максим, здравствуйте! Стоимость пилота зависит от состава сценария и объёма. Подскажите, сколько ящиков планируете подключить — подготовлю точный расчёт.",
  "denis@brook.demo": "Денис, спасибо! Буду ждать вашего ответа после планёрки. Если удобнее, могу вернуться к вам через несколько дней.",
};

let aiDraftCount = 0;

for (const [index, scenario] of scenarios.entries()) {
  const draft = "draft" in scenario ? scenario.draft : GENERATED_AI_DRAFTS[scenario.email];
  const sentReply = "sentReply" in scenario ? scenario.sentReply : undefined;
  const processed = "processed" in scenario ? scenario.processed : false;
  const pushed = "pushed" in scenario ? scenario.pushed : false;
  const manual = "manual" in scenario ? scenario.manual : false;
  const refusalSuggested = "refusalSuggested" in scenario ? scenario.refusalSuggested : false;
  const refused = "refused" in scenario ? scenario.refused : false;
  const shouldHaveAiDraft = !sentReply
    && !processed
    && !pushed
    && !manual
    && !refusalSuggested
    && !refused
    && scenario.qualification !== "IRRELEVANT";

  if (Boolean(draft) !== shouldHaveAiDraft) {
    throw new Error(`Некорректный demo-сценарий ${scenario.email}: ожидаемый AI-черновик — ${shouldHaveAiDraft ? "да" : "нет"}`);
  }
  if (draft) aiDraftCount += 1;
  const contact = await prisma.contact.upsert({
    where: { userId_email: { userId: admin.id, email: scenario.email } },
    update: { name: scenario.name, company: scenario.company, segment: scenario.segment },
    create: { userId: admin.id, email: scenario.email, name: scenario.name, company: scenario.company, segment: scenario.segment },
  });
  const sentAt = hoursAgo(scenario.age + 24);
  const inboundAt = hoursAgo(scenario.age);
  await prisma.message.create({
    data: {
      campaignId: scenario.campaignId,
      contactId: contact.id,
      subject: index % 2 ? "Re: Идея для отдела продаж" : "Re: Знакомство со Smailee",
      body: index % 2 ? "Здравствуйте! Есть идея, как разгрузить команду продаж." : "Здравствуйте! Предлагаю обсудить автоматизацию исходящих коммуникаций.",
      status: "REPLIED",
      aiRepliesEnabled: !manual,
      refusalSuggestedAt: refusalSuggested || refused ? inboundAt : null,
      refusedAt: refused ? inboundAt : null,
      autoPingStoppedAt: refused ? inboundAt : null,
      sentAt,
      deliveredAt: new Date(sentAt.getTime() + 60_000),
      openedAt: new Date(sentAt.getTime() + 3_600_000),
      repliedAt: inboundAt,
      thread: { create: [
        { direction: "inbound", fromEmail: scenario.email, toEmail: "sales@smailee.demo", subject: "Re: предложение", body: scenario.inbound, status: "SENT", createdAt: inboundAt },
        ...(draft ? [{ direction: "outbound", fromEmail: "sales@smailee.demo", toEmail: scenario.email, subject: "Re: предложение", body: draft, isAi: true, status: "DRAFT" as const, createdAt: new Date(inboundAt.getTime() + 10 * 60_000) }] : []),
        ...(sentReply ? [{ direction: "outbound", fromEmail: "sales@smailee.demo", toEmail: scenario.email, subject: "Re: предложение", body: sentReply, isAi: true, status: "SENT" as const, createdAt: new Date(inboundAt.getTime() + 20 * 60_000) }] : []),
      ] },
      lead: { create: { userId: admin.id, qualification: scenario.qualification, summary: scenario.summary, processedAt: processed ? new Date(inboundAt.getTime() + 30 * 60_000) : null, pushedToCrm: pushed, crmEntityId: pushed ? "DEMO-2048" : null, handedOffAt: pushed ? new Date(inboundAt.getTime() + 25 * 60_000) : null, handoffTrigger: pushed ? "manual" : null } },
    },
  });
}

const silentContact = await prisma.contact.upsert({
  where: { userId_email: { userId: admin.id, email: "silent@future.demo" } },
  update: { name: "Ксения Тихонова", company: "Future", segment: "SaaS" },
  create: { userId: admin.id, email: "silent@future.demo", name: "Ксения Тихонова", company: "Future", segment: "SaaS" },
});
await prisma.message.create({
  data: {
    campaignId: inboxCampaign.id,
    contactId: silentContact.id,
    subject: "Знакомство со Smailee",
    body: "Ксения, здравствуйте! Предлагаю обсудить автоматизацию исходящих коммуникаций.",
    status: "SENT",
    sentAt: hoursAgo(6),
    deliveredAt: hoursAgo(5.9),
  },
});

for (let index = 0; index < 12; index += 1) {
  const email = `analytics-${index + 1}@demo.local`;
  const contact = await prisma.contact.upsert({ where: { userId_email: { userId: admin.id, email } }, update: {}, create: { userId: admin.id, email, name: `Контакт ${index + 1}`, segment: index % 2 ? "B2B" : "SaaS" } });
  const sentAt = hoursAgo(12 + index * 2);
  await prisma.message.create({ data: { campaignId: index % 2 ? analyticsCampaign.id : inboxCampaign.id, contactId: contact.id, subject: "Тест аналитики", body: "Демонстрационное письмо", status: index < 2 ? "BOUNCED" : index < 5 ? "SENT" : index < 8 ? "DELIVERED" : index < 10 ? "OPENED" : "CLICKED", sentAt, deliveredAt: index >= 5 ? new Date(sentAt.getTime() + 60_000) : null, openedAt: index >= 8 ? new Date(sentAt.getTime() + 3_600_000) : null, clickedAt: index >= 10 ? new Date(sentAt.getTime() + 5_400_000) : null } });
}

console.log(`Готово: ${scenarios.length + 1} коммуникаций, ${aiDraftCount} AI-черновика и 12 писем аналитики для admin@smailee.ru`);
await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
