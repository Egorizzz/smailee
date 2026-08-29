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

const checkoutInput = {
  amountRub: 7999,
  buyerEmail: "buyer@test.local",
  buyerName: "ООО Тест",
  paymentId: "payment-local-id",
  planName: "Стандартный",
  successUrl: "https://app.test.local/app/billing?payment=return",
  failUrl: "https://app.test.local/app/billing?payment=failed",
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
    assert.equal("Options" in data, false);
    assert.equal("saveCard" in data, false);
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
