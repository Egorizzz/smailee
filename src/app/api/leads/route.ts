import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { config } from "@/lib/config";
import { pushLead } from "@/lib/services/bitrix";

const schema = z.object({
  name: z.string().min(1, "Укажите имя").max(200),
  email: z.string().email("Некорректный email"),
  company: z.string().max(200).optional().or(z.literal("")),
  messenger: z.string().max(200).optional().or(z.literal("")),
  source: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  // антиспам: не более 5 заявок в минуту с одного IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`leads:${ip}`, { limit: 5, windowMs: 60_000 })) {
    return NextResponse.json(
      { error: "Слишком много запросов, попробуйте через минуту" },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Проверьте поля" },
      { status: 400 }
    );
  }

  const { name, email, company, messenger, source } = parsed.data;

  await prisma.landingLead.create({
    data: {
      name,
      email,
      company: company || null,
      messenger: messenger || null,
      source: source || null,
    },
  });

  // Best-effort: заявка уже сохранена в БД и видна в админке независимо от
  // Битрикса, поэтому сбой передачи в CRM не должен возвращать ошибку форме.
  if (config.landingBitrixWebhookUrl) {
    const comment = [company ? `Компания: ${company}` : "", messenger ? `Telegram: ${messenger}` : ""]
      .filter(Boolean)
      .join("\n");
    const res = await pushLead(config.landingBitrixWebhookUrl, {
      title: `Заявка на демо — ${name}`,
      name,
      email,
      comment: comment || null,
    });
    if (!res.ok) {
      console.error(`[api/leads] передача лида в Битрикс24 не удалась: ${res.error}`);
    } else {
      console.log(`[api/leads] лид передан в Битрикс24, crmId=${res.crmId}`);
    }
  } else {
    // Без этой строки прошлый инцидент (переменная не подхватилась после
    // деплоя) выглядел неотличимо от «всё ок, просто ничего не логируем» —
    // в логах было пусто в обоих случаях.
    console.warn("[api/leads] LANDING_BITRIX_WEBHOOK_URL не задан — лид не отправлен в Битрикс24");
  }

  return NextResponse.json({ ok: true });
}
