import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Пиксель отслеживания открытий.
 * В письмо вставляется <img src="/api/track/open/<messageId>">. Когда клиент
 * открывает письмо и картинка подгружается — фиксируем открытие.
 * Возвращаем прозрачный 1x1 GIF.
 */
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;

  try {
    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (msg && !msg.openedAt) {
      await prisma.message.update({
        where: { id: messageId },
        data: {
          openedAt: new Date(),
          status: msg.status === "SENT" ? "OPENED" : msg.status,
        },
      });
      await prisma.event.create({ data: { messageId, type: "open" } });
    }
  } catch {
    // не мешаем отдаче пикселя
  }

  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
