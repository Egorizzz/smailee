import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleInboundReply } from "@/server/inboundEngine";

/**
 * Вебхук входящих ответов.
 *
 * В проде провайдер (Unisender Go / ESP) настраивается слать сюда входящие
 * письма. Мы связываем ответ с исходным письмом по адресу вида
 * reply+<messageId>@get.smailee.ru (или по In-Reply-To заголовку).
 *
 * Ожидаемое тело (упрощённо): { messageId, text } или { to, text }.
 */
export async function POST(req: NextRequest) {
  // Защита: вебхук принимает запросы только с секретом (задаётся у провайдера).
  // В dev без заданного INBOUND_SECRET проверка пропускается (для симуляции из ЛК
  // используется server action, не этот endpoint).
  const secret = process.env.INBOUND_SECRET;
  if (secret) {
    const got =
      req.headers.get("x-inbound-secret") ??
      req.nextUrl.searchParams.get("secret");
    if (got !== secret) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // в проде без секрета вебхук закрыт полностью
    return NextResponse.json(
      { error: "INBOUND_SECRET is not configured" },
      { status: 503 }
    );
  }

  let body: { messageId?: string; to?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  let messageId = body.messageId;

  // извлекаем messageId из адреса reply+<id>@...
  if (!messageId && body.to) {
    const m = body.to.match(/reply\+([^@]+)@/);
    if (m) messageId = m[1];
  }

  if (!messageId || !body.text) {
    return NextResponse.json({ error: "messageId и text обязательны" }, { status: 400 });
  }

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const result = await handleInboundReply({
    messageId,
    inboundBody: body.text,
  });

  return NextResponse.json({ ok: true, ...result });
}
