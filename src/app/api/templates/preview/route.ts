import { NextRequest, NextResponse } from "next/server";
import { getPresetByKey } from "@/lib/emailPresets";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// Отдаёт HTML-шаблон для предпросмотра в iframe. preset=<key> или id=<templateId>.
// Пресеты публичны (галерея на лендинге). Пользовательские шаблоны — только владельцу.
export async function GET(req: NextRequest) {
  const preset = req.nextUrl.searchParams.get("preset");
  const id = req.nextUrl.searchParams.get("id");

  let html = "<p style='font-family:sans-serif;padding:24px'>Нет данных</p>";

  const demoVars: Record<string, string> = {
    name: "Пётр",
    company: "ООО «Ромашка»",
    unsubscribe_url: "#",
    cta_url: "#",
  };

  if (preset) {
    const p = getPresetByKey(preset);
    if (p) html = p.html;
  } else if (id) {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    const t = await prisma.emailTemplate.findFirst({
      where: { id, OR: [{ userId: user.id }, { isPreset: true }] },
    });
    if (t) html = t.html;
  }

  // подставляем демо-переменные
  html = html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => demoVars[k] ?? "");

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // запрет исполнения скриптов в предпросмотре (защита от XSS в шаблонах)
      "Content-Security-Policy":
        "default-src 'none'; img-src * data:; style-src 'unsafe-inline'",
    },
  });
}
