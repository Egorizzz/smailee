import { NextRequest, NextResponse } from "next/server";
import { getPresetByKey } from "@/lib/emailPresets";
import { prisma } from "@/lib/prisma";

// Отдаёт HTML-шаблон для предпросмотра в iframe. preset=<key> или id=<templateId>.
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
    const t = await prisma.emailTemplate.findUnique({ where: { id } });
    if (t) html = t.html;
  }

  // подставляем демо-переменные
  html = html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => demoVars[k] ?? "");

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
