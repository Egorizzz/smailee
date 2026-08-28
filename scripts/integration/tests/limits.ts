import { checkContactLimit, checkEmailQuota, getEmailQuotaUsage } from "@/server/limits";
import { PLANS, TRIAL_UPLOAD_CONTACT_LIMIT, UPLOAD_CONTACT_LIMITS } from "@/lib/plans";
import { confirmPayment, createPendingPayment } from "@/server/billing";
import {
  assert,
  daysAgo,
  makeCampaign,
  makeContact,
  makeUser,
  prisma,
  suiteHeader,
  test,
} from "../harness";

/**
 * Тарифные лимиты. Сами планы — чистые функции и уже покрыты smoke-тестами;
 * здесь проверяется другое: что гейт правильно СЧИТАЕТ уже накопленное в БД
 * (контакты, письма за текущий месяц) и что при истёкшем платном плане в счёт
 * кабинет полностью замораживается, а не получает бесплатные лимиты.
 */

async function fillContacts(userId: string, count: number) {
  await prisma.contact.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      userId,
      email: `bulk${i}@example.test`,
    })),
  });
}

async function fillMessages(userId: string, count: number, createdAt?: Date) {
  const campaign = await makeCampaign(userId, { status: "SENT" });
  const contact = await makeContact(userId);
  await prisma.message.createMany({
    data: Array.from({ length: count }, () => ({
      campaignId: campaign.id,
      contactId: contact.id,
      subject: "Тема",
      body: "Текст",
      status: "SENT" as const,
      ...(createdAt ? { createdAt } : {}),
    })),
  });
}

export default async function run() {
  suiteHeader("limits — гейтинг тарифных квот по данным в БД");

  const basic = PLANS.BASIC;
  await test("платная загрузка считает новые уникальные email в периоде", async () => {
    const user = await makeUser({ plan: "BASIC" });
    await fillContacts(user.id, UPLOAD_CONTACT_LIMITS.BASIC - 1);
    assert.equal((await checkContactLimit(user, 1)).ok, true);
    assert.equal((await checkContactLimit(user, 2)).ok, false);
  });

  await test("пробная загрузка останавливается после общего порога", async () => {
    const user = await makeUser({ plan: "TRIAL" });
    await fillContacts(user.id, TRIAL_UPLOAD_CONTACT_LIMIT - 1);
    assert.equal((await checkContactLimit(user, 1)).ok, true);
    const overflow = await checkContactLimit(user, 2);
    assert.equal(overflow.ok, false);
    if (!overflow.ok) {
      assert.ok(overflow.error.includes("платный тариф"));
      assert.ok(!overflow.error.includes(String(TRIAL_UPLOAD_CONTACT_LIMIT)), "скрытый порог не становится постоянным продуктовым текстом");
    }
  });

  await test("письма: новый период начинается с подтверждённой оплаты", async () => {
    const trial = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const payment = await createPendingPayment({ userId: trial.id, plan: "BASIC", provider: "manual" });
    await confirmPayment(payment.id);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: trial.id } });
    await fillMessages(user.id, basic.maxEmailsPerMonth - 5);
    await fillMessages(user.id, 50, daysAgo(2)); // создано до подтверждения текущего периода

    const fits = await checkEmailQuota(user, 5);
    const overflows = await checkEmailQuota(user, 6);

    assert.equal(fits.ok, true, "расход до подтверждения текущей оплаты не входит в новый период");
    assert.equal(overflows.ok, false);
  });

  await test("демо-контакты и демо-письма не расходуют рабочие квоты", async () => {
    const user = await makeUser({ plan: "BASIC" });
    await prisma.contact.createMany({
      data: Array.from({ length: basic.maxContacts + 1 }, (_, index) => ({
        userId: user.id,
        email: `demo-limit-${index}@example.test`,
        isDemo: true,
      })),
    });
    const demoContact = await prisma.contact.findFirstOrThrow({ where: { userId: user.id, isDemo: true } });
    const demoCampaign = await makeCampaign(user.id, { status: "SENT", isDemo: true });
    await prisma.message.create({
      data: { campaignId: demoCampaign.id, contactId: demoContact.id, subject: "Демо", body: "Демо", status: "SENT", sentAt: new Date() },
    });

    assert.equal((await checkContactLimit(user, UPLOAD_CONTACT_LIMITS.BASIC)).ok, true);
    assert.equal((await getEmailQuotaUsage(user)).used, 0);
    assert.equal((await checkEmailQuota(user, basic.maxEmailsPerMonth)).ok, true);
  });

  await test("истёкший платный план полностью блокирует добавление контактов", async () => {
    const user = await makeUser({ plan: "PRO", planExpiresAt: daysAgo(1) });

    const res = await checkContactLimit(user, 1);

    assert.equal(res.ok, false);
    if (!res.ok) assert.ok(res.error.includes("Доступ приостановлен"));
  });

  await test("истёкший демо-период полностью блокирует запуск кампаний", async () => {
    const user = await makeUser({ plan: "START", isDemo: true, planExpiresAt: daysAgo(1) });
    const res = await checkEmailQuota(user, 1);
    assert.equal(res.ok, false);
    if (!res.ok) assert.ok(res.error.includes("Оплатите тариф"));
  });

  await test("активный платный план даёт свои лимиты", async () => {
    const user = await makeUser({
      plan: "PRO",
      planExpiresAt: new Date(Date.now() + 5 * 86_400_000),
    });
    await fillContacts(user.id, basic.maxContacts + 50);

    const res = await checkContactLimit(user, 1);

    assert.equal(res.ok, true, "активный PRO использует собственный лимит");
  });
}
