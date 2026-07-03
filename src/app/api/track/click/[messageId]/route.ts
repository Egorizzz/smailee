import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Трекинг кликов по ссылкам.
 * Ссылки в HTML-письме заменяются на /api/track/click/<messageId>?url=<real>.
 * Логируем клик и редиректим на реальный URL.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const url = req.nextUrl.searchParams.get("url");

  try {
    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (msg) {
      await prisma.message.update({
        where: { id: messageId },
        data: {
          clickedAt: msg.clickedAt ?? new Date(),
          openedAt: msg.openedAt ?? new Date(), // клик подразумевает открытие
          status:
            msg.status === "SENT" || msg.status === "DELIVERED" || msg.status === "OPENED"
              ? "CLICKED"
              : msg.status,
        },
      });
      await prisma.event.create({
        data: { messageId, type: "click", payload: url ? { url } : undefined },
      });
    }
  } catch {
    // не мешаем редиректу
  }

  // безопасный редирект только на http(s)
  if (url && /^https?:\/\//i.test(url)) {
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(process.env.APP_URL ?? "http://localhost:3000");
}
