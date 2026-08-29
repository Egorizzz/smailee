import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { TochkaApiError, verifyPaymentWebhook } from "@/lib/services/tochka";
import { confirmPayment } from "@/server/billing";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let event;
  try {
    event = await verifyPaymentWebhook(await req.text());
  } catch (error) {
    const code = error instanceof TochkaApiError ? error.code : "PAY-WEBHOOK-SIGNATURE";
    console.error(`[billing] rejected webhook code=${code}`, error);
    return NextResponse.json({ error: "invalid webhook" }, { status: 401 });
  }

  // При регистрации банк отправляет контрольное событие. Валидное, но не
  // относящееся к нашей операции событие всегда подтверждаем HTTP 200.
  if (event.webhookType !== "acquiringInternetPayment" || event.status !== "APPROVED") {
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (
    event.customerCode !== config.tochka.customerCode ||
    event.merchantId !== config.tochka.merchantId
  ) {
    console.error("[billing] ignored signed webhook for another merchant");
    return NextResponse.json({ ok: true, ignored: true });
  }

  let payment = event.paymentLinkId
    ? await prisma.payment.findUnique({ where: { id: event.paymentLinkId } }).catch(() => null)
    : null;
  if (!payment && event.operationId) {
    payment = await prisma.payment.findFirst({
      where: { externalId: event.operationId },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!payment && event.operationId) {
    const subscription = await prisma.billingSubscription.findUnique({
      where: { providerSubscriptionId: event.operationId },
    });
    if (subscription) {
      payment = await prisma.payment.findFirst({
        where: { subscriptionId: subscription.id, status: { in: ["PENDING", "FAILED"] } },
        orderBy: { createdAt: "desc" },
      });
    }
  }
  if (!payment) return NextResponse.json({ ok: true, ignored: true });

  const receivedAmount = Math.round(Number(event.amount) * 100);
  if (!Number.isFinite(receivedAmount) || receivedAmount !== payment.amount) {
    console.error(
      `[billing] ignored webhook with amount mismatch payment=${payment.id} expected=${payment.amount} received=${event.amount}`,
    );
    return NextResponse.json({ ok: true, ignored: true });
  }

  await confirmPayment(payment.id);
  return NextResponse.json({ ok: true });
}
