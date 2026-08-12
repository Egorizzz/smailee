import { checkContactLimit, checkEmailQuota } from "@/server/limits";
import { PLANS } from "@/lib/plans";
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

  await test("контакты: под лимит пускает, за лимит — нет", async () => {
    const user = await makeUser({ plan: "BASIC" });
    await fillContacts(user.id, basic.maxContacts - 1);

    const fits = await checkContactLimit(user, 1);
    const overflows = await checkContactLimit(user, 2);

    assert.equal(fits.ok, true, "ровно до предела — можно");
    assert.equal(overflows.ok, false, "на единицу больше — уже нельзя");
    if (!overflows.ok) {
      assert.ok(overflows.error.includes(String(basic.maxContacts)), "в тексте виден сам лимит");
      assert.ok(overflows.error.includes("Тариф"), "есть подсказка, куда идти за расширением");
    }
  });

  await test("письма: считается текущий месяц, прошлый не учитывается", async () => {
    const user = await makeUser({ plan: "BASIC" });
    await fillMessages(user.id, basic.maxEmailsPerMonth - 5);
    await fillMessages(user.id, 50, daysAgo(40)); // прошлый месяц — вне окна

    const fits = await checkEmailQuota(user, 5);
    const overflows = await checkEmailQuota(user, 6);

    assert.equal(fits.ok, true, "квота считается от первого числа текущего месяца");
    assert.equal(overflows.ok, false);
  });

  await test("истёкший платный план полностью блокирует добавление контактов", async () => {
    const user = await makeUser({ plan: "PRO", planExpiresAt: daysAgo(1) });

    const res = await checkContactLimit(user, 1);

    assert.equal(res.ok, false);
    if (!res.ok) assert.ok(res.error.includes("Срок доступа завершён"));
  });

  await test("истёкший демо-период полностью блокирует запуск кампаний", async () => {
    const user = await makeUser({ plan: "START", isDemo: true, planExpiresAt: daysAgo(1) });
    const res = await checkEmailQuota(user, 1);
    assert.equal(res.ok, false);
    if (!res.ok) assert.ok(res.error.includes("до оплаты тарифа"));
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
