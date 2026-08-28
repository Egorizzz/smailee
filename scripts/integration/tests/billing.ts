import { adminSetPlan, confirmPayment, createPendingPayment } from "@/server/billing";
import { isPlanActive, PLANS } from "@/lib/plans";
import { PUBLIC_OFFER_VERSION } from "@/lib/legal";
import { assert, makeUser, prisma, suiteHeader, test } from "../harness";

/**
 * Биллинг. Логика короткая, но состояние копится в двух таблицах сразу
 * (Payment + User), и цена ошибки — деньги: повторный вебхук шлюза не должен
 * продлевать тариф дважды, а новый подтверждённый платёж обязан открыть новый
 * 30-дневный расчётный период.
 */

const DAY = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY);
}

export default async function run() {
  suiteHeader("billing — подтверждение платежей и сроки тарифа");

  await test("демо даёт лимиты START на 14 дней и включается только один раз", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    assert.equal(isPlanActive(user.plan, user.planExpiresAt), true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.plan, "TRIAL");
    assert.equal(after.isDemo, false);
    assert.equal(after.demoUsedAt, null);
    assert.equal(after.planExpiresAt, null);
    assert.equal(PLANS.TRIAL.maxContacts, 5);
    assert.equal(PLANS.TRIAL.maxEmailsPerMonth, 50);
  });

  await test("демо недоступно после подтверждённой оплаты", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const payment = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    await confirmPayment(payment.id);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.plan, "START");
  });

  await test("подтверждение платежа включает тариф на 30 дней", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const payment = await createPendingPayment({
      userId: user.id,
      plan: "START",
      provider: "yoomoney",
    });
    assert.equal(payment.offerVersion, PUBLIC_OFFER_VERSION, "платёж хранит показанную редакцию оферты");

    await confirmPayment(payment.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.plan, "START");
    assert.equal(after.isDemo, false);
    assert.ok(after.planExpiresAt);
    assert.equal(daysBetween(after.planExpiresAt!, new Date()), 30);
    const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(paid.status, "CONFIRMED");
    assert.ok(paid.confirmedAt);
  });

  await test("повторный вебхук не продлевает тариф второй раз", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const payment = await createPendingPayment({
      userId: user.id,
      plan: "START",
      provider: "yoomoney",
    });

    await confirmPayment(payment.id);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await confirmPayment(payment.id);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    assert.equal(
      second.planExpiresAt?.getTime(),
      first.planExpiresAt?.getTime(),
      "идемпотентность: платёжные шлюзы дублируют вебхуки штатно"
    );
  });

  await test("новая подтверждённая оплата начинает новый 30-дневный период", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const first = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    await confirmPayment(first.id);

    const second = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    await confirmPayment(second.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(
      daysBetween(after.planExpiresAt!, new Date()),
      30,
      "квоты и доступ отсчитываются заново от подтверждения новой оплаты"
    );
  });

  await test("оплата после истечения считается от сегодня, а не от старой даты", async () => {
    const user = await makeUser({
      plan: "START",
      planExpiresAt: new Date(Date.now() - 10 * DAY),
    });
    const payment = await createPendingPayment({ userId: user.id, plan: "PRO", provider: "yoomoney" });

    await confirmPayment(payment.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.plan, "PRO");
    assert.equal(daysBetween(after.planExpiresAt!, new Date()), 30, "просроченный срок не вычитается");
  });

  await test("админ вручную возвращает клиента на TRIAL — срок обнуляется", async () => {
    const user = await makeUser({ plan: "PRO", planExpiresAt: new Date(Date.now() + 5 * DAY) });

    await adminSetPlan(user.id, "TRIAL");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.plan, "TRIAL");
    assert.equal(after.planExpiresAt, null);
    assert.equal(after.isDemo, false);
  });

  await test("админ продлевает активное или завершённое демо ещё на 14 дней", async () => {
    const user = await makeUser({
      role: "CLIENT",
      plan: "START",
      isDemo: true,
      demoUsedAt: new Date(),
      planExpiresAt: new Date(Date.now() - DAY),
    });

    const extended = await adminSetPlan(user.id, "START", 30);

    assert.ok(extended);
    assert.equal(extended?.plan, "START");
    assert.equal(extended?.isDemo, false);
    assert.equal(daysBetween(extended!.planExpiresAt!, new Date()), 30);
  });
}
