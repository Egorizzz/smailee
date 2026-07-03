import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().min(1, "Укажите имя").max(200),
  email: z.string().email("Некорректный email"),
  messenger: z.string().max(200).optional().or(z.literal("")),
  source: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
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

  const { name, email, messenger, source } = parsed.data;

  await prisma.landingLead.create({
    data: {
      name,
      email,
      messenger: messenger || null,
      source: source || null,
    },
  });

  return NextResponse.json({ ok: true });
}
