import { NextRequest, NextResponse } from "next/server";
import { getPresetByKey } from "@/lib/emailPresets";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// Оборачивает обычный текст в минимальный HTML-каркас письма (для предпросмотра
// текстовых писем — чтобы выглядело как письмо, а не как голый текст).
function wrapPlainText(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.65;color:#334155;white-space:pre-wrap;padding:24px;max-width:600px;">${esc}</div>`;
}

// Отдаёт HTML письма для предпросмотра в iframe. Источник — один из:
//   preset=<key>      — системный пресет (публичный, для галереи на лендинге)
//   id=<templateId>   — пользовательский/системный шаблон (только владельцу)
//   message=<msgId>   — материализованное письмо кампании с РЕАЛЬНЫМИ
//                       переменными его контакта (только владельцу кампании)
export async function GET(req: NextRequest) {
  const preset = req.nextUrl.searchParams.get("preset");
  const id = req.nextUrl.searchParams.get("id");
  const message = req.nextUrl.searchParams.get("message");

  let html = "<p style='font-family:sans-serif;padding:24px'>Нет данных</p>";

  // переменные подстановки: для message — реальные данные контакта, иначе демо
  let vars: Record<string, string> = {
    name: "Пётр",
    company: "ООО «Ромашка»",
    unsubscribe_url: "#",
    cta_url: "#",
    lead_cta_url: "#",
  };

  if (message) {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    const msg = await prisma.message.findFirst({
      where: { id: message, campaign: { userId: user.id } },
      include: { contact: true },
    });
    if (msg) {
      vars = {
        name: msg.contact.name ?? "",
        company: msg.contact.company ?? "",
        email: msg.contact.email,
        unsubscribe_url: "#",
        cta_url: user.websiteUrl ?? "#",
        lead_cta_url: "#",
      };
      html = msg.isHtml ? msg.body : wrapPlainText(msg.body);
    }
  } else if (preset) {
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
    if (t) html = t.category === "custom-text" ? wrapPlainText(t.html) : t.html;
  }

  // подстановка переменных
  html = html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // запрет исполнения скриптов в предпросмотре (защита от XSS в шаблонах)
      "Content-Security-Policy":
        "default-src 'none'; img-src * data:; style-src 'unsafe-inline'",
    },
  });
}
