import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { confirmPayment, findPaymentByExternalId } from "@/server/billing";

/**
 * Вебхук платёжного шлюза (ЮMoney-совместимый по смыслу).
 *
 * Ожидаемое тело: { externalId | label: "<paymentId или внешний id>", status: "succeeded" }.
 * Защита: секрет в заголовке X-Payment-Secret или ?secret= (задаётся у шлюза).
 *
 * При интеграции реального ЮMoney меняется только парсинг тела (notification
 * format) — подтверждение остаётся в src/server/billing.ts.
 */
export async function POST(req: NextRequest) {
  const secret = config.paymentSecret;
  if (secret) {
    const got =
      req.headers.get("x-payment-secret") ??
      req.nextUrl.searchParams.get("secret");
    if (got !== secret) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "PAYMENT_WEBHOOK_SECRET is not configured" },
      { status: 503 }
    );
  }

  let body: { externalId?: string; label?: string; paymentId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (body.status && body.status !== "succeeded" && body.status !== "success") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // платёж ищем: по нашему paymentId (передавали в label) или по внешнему id
  let payment = null;
  if (body.paymentId || body.label) {
    const pid = body.paymentId ?? body.label!;
    const { prisma } = await import("@/lib/prisma");
    payment = await prisma.payment.findUnique({ where: { id: pid } }).catch(() => null);
  }
  if (!payment && body.externalId) {
    payment = await findPaymentByExternalId(body.externalId);
  }
  if (!payment) {
    return NextResponse.json({ error: "payment not found" }, { status: 404 });
  }

  await confirmPayment(payment.id);
  return NextResponse.json({ ok: true });
}
