import { adminSetPlan, confirmPayment, createPendingPayment } from "@/server/billing";
import { assert, makeUser, prisma, suiteHeader, test } from "../harness";

/**
 * Биллинг. Логика короткая, но состояние копится в двух таблицах сразу
 * (Payment + User), и цена ошибки — деньги: повторный вебхук шлюза не должен
 * продлевать тариф дважды, а продление обязано складываться с остатком срока,
 * а не перезаписывать его.
 */

const DAY = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY);
}

export default async function run() {
  suiteHeader("billing — подтверждение платежей и сроки тарифа");

  await test("подтверждение платежа включает тариф на 30 дней", async () => {
    const user = await makeUser();
    const payment = await createPendingPayment({
      userId: user.id,
      plan: "START",
      provider: "yoomoney",
    });

    await confirmPayment(payment.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.plan, "START");
    assert.ok(after.planExpiresAt);
    assert.equal(daysBetween(after.planExpiresAt!, new Date()), 30);
    const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(paid.status, "CONFIRMED");
    assert.ok(paid.confirmedAt);
  });

  await test("повторный вебхук не продлевает тариф второй раз", async () => {
    const user = await makeUser();
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

  await test("продление складывается с остатком срока, а не перезаписывает его", async () => {
    const user = await makeUser();
    const first = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    await confirmPayment(first.id);

    const second = await createPendingPayment({ userId: user.id, plan: "START", provider: "yoomoney" });
    await confirmPayment(second.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(
      daysBetween(after.planExpiresAt!, new Date()),
      60,
      "оплатил второй месяц заранее — срок должен сложиться"
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
  });
}
