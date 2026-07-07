"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkSenderLimit } from "@/server/limits";
import { checkDomainVerification, isUnisenderLive } from "@/lib/services/unisender";

// Добавление отправителя. В mock-режиме DNS-проверка имитируется (по нажатию
// «Проверить DNS» ставим ok). С реальной инфраструктурой сюда встроится
// проверка SPF/DKIM/DMARC через DNS-резолвер провайдера.
export async function addSender(formData: FormData) {
  const user = await requireUser();
  const fromEmail = String(formData.get("fromEmail") || "").trim();
  const fromName = String(formData.get("fromName") || "").trim();
  if (!fromEmail || !fromName) return;

  // тарифный лимит отправителей
  const limit = await checkSenderLimit(user);
  if (!limit.ok) {
    redirect(`/app/sender?error=${encodeURIComponent(limit.error)}`);
  }

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

  // Ключ Project'а этого клиента в Unisender (см. docs/unisender-project-setup.md)
  // задаёт админ в /app/admin. Пока не задан ни он, ни общий ключ аккаунта —
  // остаёмся в mock-режиме, чтобы сценарий (карточка, статусы) работал целиком.
  const apiKey = user.unisenderApiKey ?? undefined;
  if (!apiKey && !isUnisenderLive) {
    await prisma.sender.update({
      where: { id },
      data: { spfOk: true, dkimOk: true, dmarcOk: true, verified: true },
    });
    revalidatePath("/app/sender");
    return;
  }

  try {
    const { ownershipOk, dkimOk } = await checkDomainVerification(sender.domain, apiKey as string);
    // Unisender не отдаёт отдельные статусы SPF/DMARC через API (см. комментарий
    // в checkDomainVerification) — их считаем подтверждёнными вместе с владением
    // доменом, т.к. они прописываются той же пачкой DNS-записей.
    await prisma.sender.update({
      where: { id },
      data: {
        spfOk: ownershipOk,
        dmarcOk: ownershipOk,
        dkimOk,
        verified: ownershipOk && dkimOk,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ошибка проверки домена";
    redirect(`/app/sender?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/app/sender");
}

export async function deleteSender(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  await prisma.sender.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/app/sender");
}
