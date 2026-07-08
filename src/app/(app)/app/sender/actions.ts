"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkSenderLimit } from "@/server/limits";
import {
  checkDomainVerification,
  expectedDnsRecords,
  isUnisenderLive,
  type DomainDnsRecord,
} from "@/lib/services/unisender";
import { config } from "@/lib/config";
import { limitsFor } from "@/lib/plans";
import { toDnsLabel, toLocalPart } from "@/lib/slug";

// Подбирает свободный managed-поддомен <slug>.smailee.ru (Sender.domain глобально
// уникален) — при коллизии добавляет числовой суффикс.
async function uniqueManagedDomain(base: string): Promise<string> {
  const root = config.mailBaseDomain;
  let candidate = `${base}.${root}`;
  let n = 1;
  while (await prisma.sender.findUnique({ where: { domain: candidate } })) {
    n += 1;
    candidate = `${base}-${n}.${root}`;
  }
  return candidate;
}

/**
 * MANAGED-отправитель: поддомен на нашем smailee.ru. DNS настраиваем мы, клиент
 * ничего не прописывает. В dev/mock сразу активен; в проде реальный провижининг
 * (запись DNS в нашу зону + домен в Project клиента) делает админ/инфра — до
 * этого verified=false и он «настраивается».
 */
export async function addManagedSender(formData: FormData) {
  const user = await requireUser();
  const fromName = String(formData.get("fromName") || "").trim();
  const localPart = toLocalPart(String(formData.get("localPart") || ""), "hello");
  const desiredSlug = toDnsLabel(
    String(formData.get("slug") || "") || user.companyName || user.email.split("@")[0],
    "client"
  );
  if (!fromName) {
    redirect(`/app/sender?error=${encodeURIComponent("Укажите имя отправителя")}`);
  }

  const limit = await checkSenderLimit(user);
  if (!limit.ok) {
    redirect(`/app/sender?error=${encodeURIComponent(limit.error)}`);
  }

  const domain = await uniqueManagedDomain(desiredSlug);
  const fromEmail = `${localPart}@${domain}`;

  await prisma.sender.create({
    data: {
      userId: user.id,
      kind: "MANAGED",
      fromEmail,
      fromName,
      domain,
      // мы владеем DNS smailee.ru → в dev считаем настроенным сразу;
      // в live ждём реального провижининга (админ), поэтому verified=false.
      spfOk: !isUnisenderLive,
      dkimOk: !isUnisenderLive,
      dmarcOk: !isUnisenderLive,
      verified: !isUnisenderLive,
    },
  });
  revalidatePath("/app/sender");
}

/**
 * OWN-отправитель: собственный домен клиента. Доступно только на тарифе с
 * customDomain (PRO). Клиент прописывает DNS у своего регистратора (записи
 * показываем в карточке) — до подтверждения verified=false.
 */
export async function addOwnSender(formData: FormData) {
  const user = await requireUser();
  const limits = limitsFor(user.plan, user.planExpiresAt);
  if (!limits.customDomain) {
    redirect(
      `/app/sender?error=${encodeURIComponent("Отправка со своего домена доступна на тарифе «Про». Оформите его в разделе «Тариф».")}`
    );
  }

  const fromEmail = String(formData.get("fromEmail") || "").trim().toLowerCase();
  const fromName = String(formData.get("fromName") || "").trim();
  if (!fromEmail || !fromName || !fromEmail.includes("@")) {
    redirect(`/app/sender?error=${encodeURIComponent("Укажите имя и корректный email на вашем домене")}`);
  }

  const limit = await checkSenderLimit(user);
  if (!limit.ok) {
    redirect(`/app/sender?error=${encodeURIComponent(limit.error)}`);
  }

  const domain = fromEmail.split("@")[1] ?? "";
  const existing = await prisma.sender.findUnique({ where: { domain } });
  if (existing) {
    redirect(`/app/sender?error=${encodeURIComponent("Этот домен уже добавлен")}`);
  }

  await prisma.sender.create({
    data: { userId: user.id, kind: "OWN", fromEmail, fromName, domain },
  });
  revalidatePath("/app/sender");
}

// DNS-записи для карточки OWN-отправителя (что прописать у регистратора).
export async function getSenderDnsRecords(
  senderId: string
): Promise<{ records: DomainDnsRecord[]; live: boolean } | null> {
  const user = await requireUser();
  const sender = await prisma.sender.findFirst({
    where: { id: senderId, userId: user.id },
  });
  if (!sender) return null;
  return expectedDnsRecords(sender.domain, user.unisenderApiKey);
}

export async function verifySender(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  const sender = await prisma.sender.findFirst({
    where: { id, userId: user.id },
  });
  if (!sender) return;

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
