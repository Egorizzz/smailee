import { adminSetPlan, confirmPayment, createPendingPayment, repairPaidPlanExpiry } from "@/server/billing";
import { isPlanActive, PLANS } from "@/lib/plans";
import { PUBLIC_OFFER_VERSION } from "@/lib/legal";
import { assert, makeUser, prisma, suiteHeader, test } from "../harness";

/**
 * Биллинг. Логика короткая, но состояние копится в двух таблицах сразу
 * (Payment + User), и цена ошибки — деньги: повторный вебхук шлюза не должен
 * продлевать тариф дважды. Первая подтверждённая оплата открывает 45 дней,
 * следующие добавляют 30 дней к ещё не истёкшему доступу.
 */

const DAY = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY);
}

export default async function run() {
  suiteHeader("billing — подтверждение платежей и сроки тарифа");

  await test("пробный тариф бессрочный и даёт собственные стартовые лимиты", async () => {
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

  await test("подтверждённая оплата переводит с пробного на рабочий тариф", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const payment = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    await confirmPayment(payment.id);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.plan, "START");
  });

  await test("первая подтверждённая оплата включает 45 дней с бесплатным прогревом", async () => {
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
    assert.equal(daysBetween(after.planExpiresAt!, new Date()), 45);
    const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(paid.status, "CONFIRMED");
    assert.ok(paid.confirmedAt);
  });

  await test("первая оплата не складывается с оставшейся датой пробного доступа", async () => {
    const legacyTrialExpiry = new Date(Date.now() + 30 * DAY);
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: legacyTrialExpiry });
    const payment = await createPendingPayment({
      userId: user.id,
      plan: "START",
      provider: "yoomoney",
    });

    await confirmPayment(payment.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.plan, "START");
    assert.ok(after.planExpiresAt);
    assert.equal(
      daysBetween(after.planExpiresAt!, new Date()),
      45,
      "первый оплаченный период начинается в момент оплаты, а не после пробной даты",
    );
  });

  await test("админ исправляет ошибочный срок по подтверждённым платежам", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const payment = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    await confirmPayment(payment.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { planExpiresAt: new Date(Date.now() + 75 * DAY) },
    });

    await repairPaidPlanExpiry(user.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(after.planExpiresAt);
    assert.equal(daysBetween(after.planExpiresAt!, new Date()), 45);
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

  await test("первая оплата с автопродлением активирует подписку через 45 дней", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const subscription = await prisma.billingSubscription.create({
      data: {
        userId: user.id,
        plan: "START",
        amount: PLANS.START.priceRub * 100,
        consentAt: new Date(),
        offerVersion: PUBLIC_OFFER_VERSION,
        providerSubscriptionId: "subscription-initial",
      },
    });
    const payment = await createPendingPayment({
      userId: user.id,
      plan: "START",
      provider: "tochka",
      kind: "SUBSCRIPTION_INITIAL",
      subscriptionId: subscription.id,
    });

    await confirmPayment(payment.id);

    const after = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    assert.equal(after.status, "ACTIVE");
    assert.ok(after.activatedAt);
    assert.ok(after.nextChargeAt);
    assert.equal(daysBetween(after.nextChargeAt!, new Date()), 45);
  });

  await test("подтверждённое автопродление назначает следующий платёж через 30 дней", async () => {
    const user = await makeUser({ plan: "START", planExpiresAt: new Date() });
    const first = await createPendingPayment({ userId: user.id, plan: "START", provider: "manual" });
    await confirmPayment(first.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { planExpiresAt: new Date(Date.now() - 1_000) },
    });
    const subscription = await prisma.billingSubscription.create({
      data: {
        userId: user.id,
        plan: "START",
        amount: PLANS.START.priceRub * 100,
        consentAt: new Date(),
        providerSubscriptionId: "subscription-renewal",
        status: "CHARGING",
        activatedAt: new Date(),
        chargeStartedAt: new Date(),
      },
    });
    const renewal = await createPendingPayment({
      userId: user.id,
      plan: "START",
      provider: "tochka",
      kind: "SUBSCRIPTION_RENEWAL",
      subscriptionId: subscription.id,
    });

    await confirmPayment(renewal.id);

    const after = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    assert.equal(after.status, "ACTIVE");
    assert.equal(after.chargeStartedAt, null);
    assert.ok(after.nextChargeAt);
    assert.equal(daysBetween(after.nextChargeAt!, new Date()), 30);
  });

  await test("отключённая подписка не включается повторно запоздавшим webhook", async () => {
    const user = await makeUser({ plan: "START", planExpiresAt: new Date() });
    const subscription = await prisma.billingSubscription.create({
      data: {
        userId: user.id,
        plan: "START",
        amount: PLANS.START.priceRub * 100,
        consentAt: new Date(),
        providerSubscriptionId: "subscription-cancelled",
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });
    const renewal = await createPendingPayment({
      userId: user.id,
      plan: "START",
      provider: "tochka",
      kind: "SUBSCRIPTION_RENEWAL",
      subscriptionId: subscription.id,
    });

    await confirmPayment(renewal.id);

    const after = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.nextChargeAt, null);
  });

  await test("явно выбранная разовая оплата отключает прежнее автопродление", async () => {
    const user = await makeUser({ plan: "START", planExpiresAt: new Date(Date.now() + 10 * DAY) });
    const subscription = await prisma.billingSubscription.create({
      data: {
        userId: user.id,
        plan: "START",
        amount: PLANS.START.priceRub * 100,
        consentAt: new Date(),
        providerSubscriptionId: "subscription-before-one-time",
        status: "ACTIVE",
        nextChargeAt: new Date(Date.now() + 10 * DAY),
      },
    });
    const payment = await createPendingPayment({
      userId: user.id,
      plan: "START",
      provider: "tochka",
      kind: "ONE_TIME",
    });

    await confirmPayment(payment.id);

    const after = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.nextChargeAt, null);
  });

  await test("два одновременных платежа не получают бонус первой оплаты дважды и оба оплаченных периода сохраняются", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const first = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    const second = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });

    await Promise.all([confirmPayment(first.id), confirmPayment(second.id)]);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(daysBetween(after.planExpiresAt!, new Date()), 75);
    assert.equal(await prisma.payment.count({ where: { userId: user.id, status: "CONFIRMED" } }), 2);
  });

  await test("раннее продление добавляет 30 дней к оставшемуся оплаченному сроку", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const first = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    await confirmPayment(first.id);

    const second = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    await confirmPayment(second.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(
      daysBetween(after.planExpiresAt!, new Date()),
      75,
      "45 дней первого периода и 30 дней продления сохраняются полностью"
    );
  });

  await test("смена тарифа сохраняет оставшиеся оплаченные дни", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const first = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    await confirmPayment(first.id);
    const beforeSwitch = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const payment = await createPendingPayment({ userId: user.id, plan: "PRO", provider: "yoomoney" });

    await confirmPayment(payment.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.plan, "PRO");
    assert.ok(beforeSwitch.planExpiresAt);
    assert.ok(after.planExpiresAt);
    assert.equal(
      daysBetween(after.planExpiresAt!, beforeSwitch.planExpiresAt!),
      30,
      "новый период добавляется после уже оплаченной даты"
    );
  });

  await test("смена тарифа с автопродлением заменяет прежнюю подписку и сохраняет срок", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const first = await createPendingPayment({ userId: user.id, plan: "START", provider: "manual" });
    await confirmPayment(first.id);
    const currentExpiresAt = new Date(Date.now() + 12 * DAY);
    await prisma.user.update({
      where: { id: user.id },
      data: { planExpiresAt: currentExpiresAt },
    });
    const previousSubscription = await prisma.billingSubscription.create({
      data: {
        userId: user.id,
        plan: "START",
        amount: PLANS.START.priceRub * 100,
        consentAt: new Date(),
        status: "ACTIVE",
        nextChargeAt: currentExpiresAt,
      },
    });
    const nextSubscription = await prisma.billingSubscription.create({
      data: {
        userId: user.id,
        plan: "PRO",
        amount: PLANS.PRO.priceRub * 100,
        consentAt: new Date(),
      },
    });
    const payment = await createPendingPayment({
      userId: user.id,
      plan: "PRO",
      provider: "tochka",
      kind: "SUBSCRIPTION_INITIAL",
      subscriptionId: nextSubscription.id,
    });

    await confirmPayment(payment.id);

    const [afterUser, previousAfter, nextAfter] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.billingSubscription.findUniqueOrThrow({ where: { id: previousSubscription.id } }),
      prisma.billingSubscription.findUniqueOrThrow({ where: { id: nextSubscription.id } }),
    ]);
    assert.equal(afterUser.plan, "PRO");
    assert.ok(afterUser.planExpiresAt);
    assert.equal(daysBetween(afterUser.planExpiresAt!, currentExpiresAt), 30);
    assert.equal(previousAfter.status, "CANCELLED");
    assert.equal(previousAfter.nextChargeAt, null);
    assert.equal(nextAfter.status, "ACTIVE");
    assert.equal(nextAfter.nextChargeAt?.getTime(), afterUser.planExpiresAt?.getTime());
  });

  await test("оплата после истечения считается от сегодня, а не от старой даты", async () => {
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const first = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    await confirmPayment(first.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { planExpiresAt: new Date(Date.now() - 10 * DAY) },
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
