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
 * идут TRIAL-лимиты, а не оплаченные когда-то.
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

  const trial = PLANS.TRIAL;

  await test("контакты: под лимит пускает, за лимит — нет", async () => {
    const user = await makeUser();
    await fillContacts(user.id, trial.maxContacts - 1);

    const fits = await checkContactLimit(user, 1);
    const overflows = await checkContactLimit(user, 2);

    assert.equal(fits.ok, true, "ровно до предела — можно");
    assert.equal(overflows.ok, false, "на единицу больше — уже нельзя");
    if (!overflows.ok) {
      assert.ok(overflows.error.includes(String(trial.maxContacts)), "в тексте виден сам лимит");
      assert.ok(overflows.error.includes("Тариф"), "есть подсказка, куда идти за расширением");
    }
  });

  await test("письма: считается текущий месяц, прошлый не учитывается", async () => {
    const user = await makeUser();
    await fillMessages(user.id, trial.maxEmailsPerMonth - 5);
    await fillMessages(user.id, 50, daysAgo(40)); // прошлый месяц — вне окна

    const fits = await checkEmailQuota(user, 5);
    const overflows = await checkEmailQuota(user, 6);

    assert.equal(fits.ok, true, "квота считается от первого числа текущего месяца");
    assert.equal(overflows.ok, false);
  });

  await test("истёкший платный план считает по TRIAL-лимитам", async () => {
    // effectivePlan откатывает PRO на TRIAL — гейт обязан это учитывать,
    // иначе неоплаченный аккаунт продолжает грузить базу по старому тарифу
    const user = await makeUser({ plan: "PRO", planExpiresAt: daysAgo(1) });
    await fillContacts(user.id, trial.maxContacts);

    const res = await checkContactLimit(user, 1);

    assert.equal(res.ok, false);
    assert.ok(PLANS.PRO.maxContacts > trial.maxContacts, "на активном PRO места хватило бы");
  });

  await test("активный платный план даёт свои лимиты", async () => {
    const user = await makeUser({
      plan: "PRO",
      planExpiresAt: new Date(Date.now() + 5 * 86_400_000),
    });
    await fillContacts(user.id, trial.maxContacts + 50);

    const res = await checkContactLimit(user, 1);

    assert.equal(res.ok, true, "оплаченный тариф не упирается в TRIAL-потолок");
  });
}
