import type { SystemMail } from "@/lib/systemMail";
import { adminSetPlan, confirmPayment, createPendingPayment } from "@/server/billing";
import { deliverPlanNotifications, syncPlanNotifications } from "@/server/planNotifications";
import { assert, makeUser, prisma, suiteHeader, test } from "../harness";

const DAY = 86_400_000;

export default async function run() {
  suiteHeader("planNotifications — окончание тарифа и реактивация");

  await test("платный тариф создаёт один цикл отключения и возврата", async () => {
    const now = new Date("2026-08-14T09:00:00.000Z");
    const user = await makeUser({
      plan: "START",
      isDemo: false,
      planExpiresAt: new Date(now.getTime() + 14 * DAY),
    });

    await syncPlanNotifications(now);
    await syncPlanNotifications(now);

    const rows = await prisma.planNotification.findMany({
      where: { userId: user.id },
      orderBy: { scheduledAt: "asc" },
    });
    assert.deepEqual(rows.map((row) => row.kind), ["PLAN_DISABLED", "RETURN_3D", "RETURN_10D", "RETURN_30D"]);
  });

  await test("предупреждение получает только администратор организации", async () => {
    const now = new Date("2026-08-14T09:00:00.000Z");
    const owner = await makeUser({
      email: "owner@test.local",
      organizationRole: "ORG_ADMIN",
      plan: "START",
      isDemo: false,
      planExpiresAt: now,
    });
    const organization = await prisma.organization.create({
      data: { ownerId: owner.id, name: "Тест" },
    });
    await prisma.user.update({ where: { id: owner.id }, data: { organizationId: organization.id } });
    await makeUser({
      email: "employee@test.local",
      organization: { connect: { id: organization.id } },
      organizationRole: "MEMBER",
    });
    await makeUser({
      email: "second-admin@test.local",
      organization: { connect: { id: organization.id } },
      organizationRole: "ORG_ADMIN",
    });
    await syncPlanNotifications(now);

    const sent: SystemMail[] = [];
    const result = await deliverPlanNotifications(now, async (mail) => {
      sent.push(mail);
      return { ok: true as const };
    });

    assert.equal(result.sent, 1);
    assert.deepEqual([...(sent[0].to as string[])].sort(), ["owner@test.local", "second-admin@test.local"]);
    assert.equal(sent[0].subject, "Доступ к Smailee приостановлен");
    assert.equal(sent[0].from, undefined, "уведомление использует SYSTEM_MAIL_FROM/no-reply");
  });

  await test("покупка отменяет оставшуюся цепочку истечения тарифа", async () => {
    const now = new Date();
    const user = await makeUser({
      plan: "START",
      isDemo: false,
      planExpiresAt: new Date(now.getTime() + 7 * DAY),
    });
    await syncPlanNotifications(now);
    const payment = await createPendingPayment({ userId: user.id, plan: "PRO", provider: "manual" });
    await confirmPayment(payment.id);

    const pending = await prisma.planNotification.count({
      where: { userId: user.id, sentAt: null, canceledAt: null },
    });
    assert.equal(pending, 0);
  });

  await test("PENDING не останавливает письма, а продление отменяет старый срок", async () => {
    const now = new Date();
    const oldExpiry = new Date(now.getTime() + 7 * DAY);
    const user = await makeUser({
      role: "CLIENT",
      plan: "START",
      isDemo: true,
      demoUsedAt: now,
      planExpiresAt: oldExpiry,
    });
    await syncPlanNotifications(now);
    await createPendingPayment({ userId: user.id, plan: "START", provider: "manual" });
    assert.ok(await prisma.planNotification.count({
      where: { userId: user.id, sentAt: null, canceledAt: null },
    }));

    await adminSetPlan(user.id, "START", 30);
    assert.equal(await prisma.planNotification.count({
      where: { userId: user.id, sentAt: null, canceledAt: null },
    }), 0);
    await syncPlanNotifications(now);
    const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const newCycle = await prisma.planNotification.findFirstOrThrow({
      where: { userId: user.id, canceledAt: null },
    });
    assert.equal(newCycle.planEndsAt.getTime(), current.planExpiresAt?.getTime());
    assert.notEqual(newCycle.planEndsAt.getTime(), oldExpiry.getTime());
  });

  await test("истечение платного тарифа отправляет отключение и готовит возврат", async () => {
    const expiresAt = new Date("2026-08-10T09:00:00.000Z");
    const now = new Date(expiresAt.getTime() + 3 * DAY);
    const user = await makeUser({
      plan: "BASIC",
      isDemo: false,
      planExpiresAt: expiresAt,
    });
    await syncPlanNotifications(now);

    const sent: SystemMail[] = [];
    const result = await deliverPlanNotifications(now, async (mail) => {
      sent.push(mail);
      return { ok: true as const };
    });

    assert.equal(result.sent, 2);
    assert.deepEqual(sent.map((mail) => mail.subject), [
      "Доступ к Smailee приостановлен",
      "Помочь вам вернуться в Smailee?",
    ]);
    assert.equal(sent[0].from, undefined);
    assert.match(sent[1].from ?? "", /info@smailee\.ru/);
    assert.equal(sent[1].replyTo, sent[1].from);
    assert.ok(sent.every((mail) => mail.to === user.email || (Array.isArray(mail.to) && mail.to.includes(user.email))));
  });

  await test("ручная смена тарифа отменяет старые уведомления и не создаёт новый цикл", async () => {
    const active = await makeUser({
      plan: "PRO",
      isDemo: false,
      planExpiresAt: new Date(Date.now() + 20 * DAY),
    });
    await adminSetPlan(active.id, "TRIAL");
    assert.equal(await prisma.planNotification.count({ where: { userId: active.id } }), 0);

    const switched = await makeUser({
      plan: "BASIC",
      isDemo: false,
      planExpiresAt: new Date(Date.now() + 20 * DAY),
    });
    await adminSetPlan(switched.id, "START");
    assert.equal(await prisma.planNotification.count({ where: { userId: switched.id } }), 0);
  });

  await test("перевод истёкшего тарифа в Trial отменяет оставшуюся цепочку возврата", async () => {
    const expiresAt = new Date(Date.now() - 4 * DAY);
    const user = await makeUser({ plan: "PRO", planExpiresAt: expiresAt, isDemo: false });
    await syncPlanNotifications(new Date());
    const disabled = await prisma.planNotification.findFirstOrThrow({
      where: { userId: user.id, kind: "PLAN_DISABLED" },
    });
    await prisma.planNotification.update({
      where: { id: disabled.id },
      data: { sentAt: new Date() },
    });

    await adminSetPlan(user.id, "TRIAL");

    assert.equal(await prisma.planNotification.count({
      where: { userId: user.id, kind: "PLAN_DISABLED" },
    }), 1);
    const returns = await prisma.planNotification.findMany({
      where: { userId: user.id, kind: { in: ["RETURN_3D", "RETURN_10D", "RETURN_30D"] } },
    });
    assert.equal(returns.length, 3);
    assert.ok(returns.every((row) => row.canceledAt !== null));
  });
}
