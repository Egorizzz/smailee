"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Добавление отправителя. В mock-режиме DNS-проверка имитируется (по нажатию
// «Проверить DNS» ставим ok). С реальной инфраструктурой сюда встроится
// проверка SPF/DKIM/DMARC через DNS-резолвер провайдера.
export async function addSender(formData: FormData) {
  const user = await requireUser();
  const fromEmail = String(formData.get("fromEmail") || "").trim();
  const fromName = String(formData.get("fromName") || "").trim();
  if (!fromEmail || !fromName) return;
  const domain = fromEmail.split("@")[1] ?? "";

  await prisma.sender.create({
    data: { userId: user.id, fromEmail, fromName, domain },
  });
  revalidatePath("/app/sender");
}

export async function verifySender(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  const sender = await prisma.sender.findFirst({
    where: { id, userId: user.id },
  });
  if (!sender) return;

  // MOCK: имитируем успешную проверку DNS.
  // TODO(prod): реальная проверка TXT-записей SPF/DKIM/DMARC через dns.resolveTxt.
  await prisma.sender.update({
    where: { id },
    data: { spfOk: true, dkimOk: true, dmarcOk: true, verified: true },
  });
  revalidatePath("/app/sender");
}

export async function deleteSender(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  await prisma.sender.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/app/sender");
}
