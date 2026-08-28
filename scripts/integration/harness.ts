import assert from "node:assert";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import type { Prisma } from "@prisma/client";

/**
 * Общая обвязка интеграционных тестов: раннер, очистка БД между тестами и
 * фабрики фикстур.
 *
 * Раннер намеренно свой, а не внешний фреймворк: smoke.ts уже использует такой
 * же минимальный подход (node:assert + счётчик), лишняя зависимость в проде
 * ради тестов не нужна.
 *
 * ВАЖНО: модуль тянет @/lib/prisma, а тот читает DATABASE_URL при создании
 * клиента. Поэтому harness (и всё, что его импортирует) должен грузиться ТОЛЬКО
 * динамически, уже после того как run.ts подменил DATABASE_URL на тестовую БД.
 */

let passed = 0;
let failed = 0;
const failures: { name: string; error: string }[] = [];

/**
 * Полная очистка данных между тестами. Достаточно удалить пользователей:
 * mailbox/domainGroup/contact/campaign/payment/suppression и всё остальное
 * висит на User через onDelete: Cascade, а message/event/warmupEvent — на них.
 * LandingLead ни от кого не зависит, поэтому чистится отдельно.
 */
export async function resetDb() {
  await prisma.externalDataOperation.deleteMany();
  await prisma.company.deleteMany();
  await prisma.companyFieldDefinition.deleteMany();
  await prisma.companyDataSource.deleteMany();
  await prisma.adminTelegramRecipient.deleteMany();
  await prisma.adminNotification.deleteMany();
  await prisma.user.deleteMany();
  await prisma.landingLead.deleteMany();
  await prisma.emailTemplate.deleteMany();
}

export async function test(name: string, fn: () => Promise<void>) {
  await resetDb();
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    failures.push({ name, error: message });
    console.log(`  FAIL ${name}`);
  }
}

export function suiteHeader(name: string) {
  console.log(`\n${name}`);
}

/** Итоговый отчёт. Возвращает код выхода процесса. */
export function report(): number {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nПодробности:");
    for (const f of failures) {
      console.log(`\n— ${f.name}\n${f.error}`);
    }
    return 1;
  }
  return 0;
}

export { assert };

// ── Хелперы времени ──

export function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

// ── Фабрики фикстур ──

let seq = 0;
function uniq(prefix: string): string {
  return `${prefix}${++seq}`;
}

export async function makeUser(data: Partial<Prisma.UserCreateInput> = {}) {
  return prisma.user.create({
    data: {
      email: `${uniq("user")}@test.local`,
      passwordHash: "x",
      offer: "Тестовый оффер",
      plan: "START",
      planExpiresAt: new Date(Date.now() + 30 * 86_400_000),
      ...data,
    },
  });
}

export async function makeDomain(userId: string, data: Partial<Prisma.DomainGroupCreateManyInput> = {}) {
  return prisma.domainGroup.create({
    data: {
      userId,
      domain: `${uniq("domain")}.test.local`,
      ...data,
    },
  });
}

/**
 * Ящик, настроенный на фейковый SMTP. По умолчанию сразу пригоден для холодной
 * отправки (connState=ok, warmupState=warm) — иначе loadUsableMailboxes его
 * не возьмёт и тест проверит не то, что задумано.
 */
export async function makeMailbox(input: {
  userId: string;
  domainGroupId: string;
  smtpPort: number;
  email?: string;
  data?: Partial<Prisma.MailboxCreateManyInput>;
}) {
  const email = input.email ?? `${uniq("box")}@test.local`;
  return prisma.mailbox.create({
    data: {
      userId: input.userId,
      domainGroupId: input.domainGroupId,
      email,
      senderName: "Тест Отправитель",
      smtpHost: "127.0.0.1",
      smtpPort: input.smtpPort,
      // фейковый SMTP не умеет TLS: STARTTLS => secure=false в transport.ts,
      // а сам STARTTLS сервер не объявляет, поэтому апгрейда не происходит
      smtpSecurity: "STARTTLS",
      smtpLogin: email,
      imapHost: "127.0.0.1",
      imapPort: 1,
      imapLogin: email,
      smtpPasswordEnc: encryptSecret("secret"),
      imapPasswordEnc: encryptSecret("secret"),
      connState: "ok",
      warmupState: "warm",
      ...input.data,
    },
  });
}

export async function makeContact(userId: string, data: Partial<Prisma.ContactCreateManyInput> = {}) {
  return prisma.contact.create({
    data: {
      userId,
      email: `${uniq("contact")}@example.test`,
      name: "Иван",
      ...data,
    },
  });
}

export async function makeCampaign(userId: string, data: Partial<Prisma.CampaignCreateManyInput> = {}) {
  return prisma.campaign.create({
    data: {
      userId,
      name: "Тестовая кампания",
      subject: "Тема",
      body: "Текст письма",
      status: "QUEUED",
      ...data,
    },
  });
}

export async function makeFollowupStep(
  campaignId: string,
  stepNumber: number,
  data: Partial<Prisma.FollowupStepCreateManyInput> = {}
) {
  return prisma.followupStep.create({
    data: {
      campaignId,
      stepNumber,
      daysAfterPrevious: 3,
      subject: "Re: Тема",
      body: "Текст follow-up",
      ...data,
    },
  });
}

export async function makeMessage(
  campaignId: string,
  contactId: string,
  data: Partial<Prisma.MessageCreateManyInput> = {}
) {
  return prisma.message.create({
    data: {
      campaignId,
      contactId,
      subject: "Тема",
      body: "Текст письма",
      status: "PENDING",
      // Most integration suites exercise SMTP/IMAP invariants in isolation.
      // Dedicated personalization tests opt back into PENDING explicitly.
      personalizationStatus: "READY",
      ...data,
    },
  });
}

/** Кампания + N контактов + N писем в очереди — типовая заготовка для sendEngine. */
export async function makeQueuedCampaign(userId: string, count: number) {
  const campaign = await makeCampaign(userId);
  const contacts = [];
  for (let i = 0; i < count; i++) {
    const contact = await makeContact(userId);
    await makeMessage(campaign.id, contact.id);
    contacts.push(contact);
  }
  return { campaign, contacts };
}

export { prisma };
