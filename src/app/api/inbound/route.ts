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
