import { X509Certificate } from "node:crypto";
import {
  chargeSubscription,
  createOneTimePayment,
  createSubscription,
  ensurePaymentWebhook,
  verifyPaymentWebhook,
} from "@/lib/services/tochka";
import { RUSSIAN_TRUSTED_ROOT_CA } from "@/lib/services/russianTrustedRootCa";
import { assert, suiteHeader, test } from "../harness";
import type { FakeTochka } from "../fakeTochka";
import { createCheckout } from "@/server/paymentCheckout";
import { makeUser, prisma } from "../harness";

const checkoutInput = {
  amountRub: 7999,
  buyerEmail: "buyer@test.local",
  buyerName: "ООО Тест",
  paymentId: "payment-local-id",
  planName: "Стандартный",
  successUrl: "https://app.test.local/app/billing?payment=return",
  failUrl: "https://app.test.local/app/billing?payment=failed",
  ttlMinutes: 10_080,
};

export default async function run(_smtp: unknown, _bitrix: unknown, tochka: FakeTochka) {
  suiteHeader("payment provider — чеки, подписки и подпись webhook");

  await test("HTTPS-клиент использует проверенный корень Минцифры", async () => {
    const certificate = new X509Certificate(RUSSIAN_TRUSTED_ROOT_CA);
    assert.equal(
      certificate.fingerprint256,
      "D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31",
    );
    assert.match(certificate.subject, /CN=Russian Trusted Root CA/);
    assert.equal(certificate.checkIssued(certificate), true);
  });

  await test("разовая оплата передаёт сумму числом, УСН и чек без НДС", async () => {
    tochka.reset();
    const result = await createOneTimePayment(checkoutInput);
    assert.equal(result.operationId, "payment-1");
    const request = tochka.requests[0];
    const data = (request.body as { Data: Record<string, unknown> }).Data;
    assert.equal(request.path, "/acquiring/v1.0/payments_with_receipt");
    assert.equal(data.amount, 7999);
    assert.deepEqual(data.paymentMode, ["card", "sbp"]);
    assert.equal(data.ttl, 10_080);
    assert.equal(data.taxSystemCode, "usn_income");
    const item = (data.Items as Record<string, unknown>[])[0];
    assert.equal(item.amount, 7999);
    assert.equal(item.vatType, "none");
    assert.equal(item.paymentMethod, "full_payment");
    assert.equal(item.paymentObject, "service");
  });

  await test("подписка включает произвольный график без скрытого расписания банка", async () => {
    tochka.reset();
    const result = await createSubscription(checkoutInput);
    assert.equal(result.operationId, "subscription-1");
    const data = (tochka.requests[0].body as { Data: Record<string, unknown> }).Data;
    assert.equal(data.recurring, true);
    assert.equal("ttl" in data, false);
    assert.equal("Options" in data, false);
    assert.equal("saveCard" in data, false);
  });

  await test("повторный клик использует живую платёжную ссылку, а не создаёт дубль", async () => {
    tochka.reset();
    const user = await makeUser({ plan: "TRIAL", planExpiresAt: null });
    const input = {
      userId: user.id,
      plan: "BASIC" as const,
      buyerEmail: user.email,
      autoRenew: false,
      activationMode: "IMMEDIATE" as const,
    };

    const first = await createCheckout(input);
    const second = await createCheckout(input);

    assert.equal(second, first);
    assert.equal(tochka.requests.filter((request) => request.path === "/acquiring/v1.0/payments_with_receipt").length, 1);
    assert.equal(await prisma.payment.count({ where: { userId: user.id, status: "PENDING" } }), 1);
    const payment = await prisma.payment.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(payment.changeType, "ACTIVATE");
  });

  await test("даунгрейд на следующий период списывает полную цену и сохраняет дату активации", async () => {
    tochka.reset();
    const periodEndsAt = new Date(Date.now() + 12 * 86_400_000);
    const user = await makeUser({
      plan: "START",
      planSource: "PAYMENT",
      planPeriodStartedAt: new Date(Date.now() - 18 * 86_400_000),
      planExpiresAt: periodEndsAt,
    });

    await createCheckout({
      userId: user.id,
      plan: "BASIC",
      buyerEmail: user.email,
      autoRenew: false,
      activationMode: "NEXT_PERIOD",
    });

    const payment = await prisma.payment.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(payment.amount, 3990 * 100);
    assert.equal(payment.changeType, "DOWNGRADE");
    assert.equal(payment.activationMode, "NEXT_PERIOD");
    assert.equal(payment.entitlementEndsAt?.getTime(), periodEndsAt.getTime());
  });

  await test("повторное списание разбирает фактический Data.result", async () => {
    tochka.reset();
    const result = await chargeSubscription("subscription-1", 7999);
    assert.equal(result.Data?.result, true);
    const data = (tochka.requests[0].body as { Data: Record<string, unknown> }).Data;
    assert.equal(data.amount, 7999);
  });

  await test("webhook принимается только с корректной подписью RS256", async () => {
    const event = {
      webhookType: "acquiringInternetPayment",
      status: "APPROVED",
      operationId: "payment-1",
      amount: "7999.00",
    };
    const verified = await verifyPaymentWebhook(tochka.sign(event));
    assert.equal(verified.webhookType, event.webhookType);
    assert.equal(verified.status, event.status);
    assert.equal(verified.operationId, event.operationId);
    assert.equal(verified.amount, event.amount);
    await assert.rejects(() => verifyPaymentWebhook("broken.jwt.token"));
  });

  await test("регистрация webhook идемпотентна", async () => {
    tochka.reset();
    await ensurePaymentWebhook("https://app.test.local/api/payments/webhook");
    await ensurePaymentWebhook("https://app.test.local/api/payments/webhook");
    assert.equal(tochka.requests.filter((item) => item.method === "PUT").length, 1);
    assert.equal(tochka.requests.filter((item) => item.method === "POST").length, 0);
  });
}
