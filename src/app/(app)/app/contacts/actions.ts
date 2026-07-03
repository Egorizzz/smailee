"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Простой парсер CSV (разделитель , или ;). Ожидаемые колонки (в любом
// порядке, регистронезависимо): email, name/имя, company/компания, segment/сегмент.
function parseCsv(text: string): {
  email: string;
  name?: string;
  company?: string;
  segment?: string;
}[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ""));

  const idx = (names: string[]) =>
    headers.findIndex((h) => names.includes(h));

  const emailI = idx(["email", "e-mail", "почта", "мейл"]);
  const nameI = idx(["name", "имя", "фио", "контакт"]);
  const companyI = idx(["company", "компания", "организация"]);
  const segmentI = idx(["segment", "сегмент", "ниша", "тег"]);

  if (emailI === -1) return [];

  const rows: {
    email: string;
    name?: string;
    company?: string;
    segment?: string;
  }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]
      .split(delimiter)
      .map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const email = cells[emailI]?.toLowerCase();
    if (!email || !email.includes("@")) continue;
    rows.push({
      email,
      name: nameI > -1 ? cells[nameI] : undefined,
      company: companyI > -1 ? cells[companyI] : undefined,
      segment: segmentI > -1 ? cells[segmentI] : undefined,
    });
  }
  return rows;
}

export async function uploadContacts(formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return;

  const text = await file.text();
  const rows = parseCsv(text);

  let created = 0;
  for (const r of rows) {
    try {
      await prisma.contact.upsert({
        where: { userId_email: { userId: user.id, email: r.email } },
        update: {
          name: r.name,
          company: r.company,
          segment: r.segment,
        },
        create: {
          userId: user.id,
          email: r.email,
          name: r.name,
          company: r.company,
          segment: r.segment,
        },
      });
      created++;
    } catch {
      // пропускаем битые строки
    }
  }
  revalidatePath("/app/contacts");
}

export async function clearContacts() {
  const user = await requireUser();
  await prisma.contact.deleteMany({ where: { userId: user.id } });
  revalidatePath("/app/contacts");
}
