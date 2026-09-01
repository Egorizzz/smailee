"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { decryptSecret, hasEncKey } from "@/lib/crypto";
import { provisionMailbox } from "@/server/mailboxProvisioning";
import type { MailProvider } from "@prisma/client";
import { isDemoWorkspaceActive } from "@/lib/demoWorkspace";
import { limitsFor } from "@/lib/plans";
import { validateMailbox } from "@/lib/mail/validate";
import { config } from "@/lib/config";

// Ручное добавление одного ящика.
export async function connectMailbox(formData: FormData): Promise<{ ok?: string; error?: string }> {
  const workspace = await requireCapability("INFRASTRUCTURE_MANAGE");
  if (await isDemoWorkspaceActive(workspace.organizationId)) return { error: "Рабочая инфраструктура недоступна для изменения в демо-режиме" };
  const user = workspace.owner;
  const mailboxCount = await prisma.mailbox.count({ where: { userId: user.id } });
  const mailboxLimit = limitsFor(user.plan, user.planExpiresAt).mailboxQuota;
  if (mailboxCount >= mailboxLimit) {
    return { error: `На вашем тарифе доступно ящиков: ${mailboxLimit}. Выберите тариф, чтобы подключить ещё.` };
  }
  if (!hasEncKey()) {
    return { error: "Не задан MAILBOX_ENC_KEY в .env — без него доступы к ящикам не шифруются. Сгенерируйте: openssl rand -hex 32" };
  }

  const provider = (String(formData.get("provider") || "yandex") as MailProvider);
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const senderName = String(formData.get("senderName") || "").trim();
  const appPassword = String(formData.get("appPassword") || "");
  const confirmedWarm = formData.get("confirmedWarm") === "on";

  if (!email.includes("@") || !senderName || !appPassword) {
    return { error: "Укажите имя отправителя, email и пароль приложения" };
  }

  const err = await provisionMailbox({
    userId: user.id,
    email,
    senderName,
    provider,
    appPassword,
    mode: "customer",
    alreadyWarm: confirmedWarm,
  });
  revalidatePath("/app/mailboxes");
  if (err) return { error: err };
  return {
    ok: confirmedWarm
      ? `Ящик ${email} подключён и отмечен как прогретый`
      : `Ящик ${email} подключён`,
  };
}

export async function deleteMailbox(formData: FormData) {
  const workspace = await requireCapability("INFRASTRUCTURE_MANAGE");
  if (await isDemoWorkspaceActive(workspace.organizationId)) return;
  const user = workspace.owner;
  const id = String(formData.get("id"));
  await prisma.mailbox.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/app/mailboxes");
}

// Ручная пауза (§5.8) — то же состояние, что и авто-пауза мониторингом
// здоровья (computeFleetHealth), поэтому ящик так же выпадает из ротации
// отправки/приёма/прогрева (connState=disabled ни в одном allow-list M2–M4).
export async function pauseMailbox(formData: FormData) {
  const workspace = await requireCapability("INFRASTRUCTURE_MANAGE");
  if (await isDemoWorkspaceActive(workspace.organizationId)) return;
  const user = workspace.owner;
  const id = String(formData.get("id"));
  await prisma.mailbox.updateMany({
    where: { id, userId: user.id },
    data: {
      connState: "disabled",
      pausedReason: "Приостановлено оператором вручную",
      pauseKind: "MANUAL",
      nextReconnectAt: null,
      reconnectAttempts: 0,
    },
  });
  revalidatePath("/app/mailboxes");
}

// Возобновление всегда начинается с реальной проверки SMTP и IMAP. Нельзя
// возвращать ящик в ротацию одной сменой статуса: сохранённый пароль мог быть
// отозван, а сервер — оставаться недоступным.
export async function resumeMailbox(formData: FormData) {
  const workspace = await requireCapability("INFRASTRUCTURE_MANAGE");
  if (await isDemoWorkspaceActive(workspace.organizationId)) return;
  const user = workspace.owner;
  const id = String(formData.get("id"));
  const mailbox = await prisma.mailbox.findFirst({ where: { id, userId: user.id } });
  if (!mailbox) return;

  const result = await validateMailbox({
    email: mailbox.email,
    smtpHost: mailbox.smtpHost,
    smtpPort: mailbox.smtpPort,
    smtpSecurity: mailbox.smtpSecurity,
    imapHost: mailbox.imapHost,
    imapPort: mailbox.imapPort,
    imapSecurity: mailbox.imapSecurity,
    smtpLogin: mailbox.smtpLogin,
    imapLogin: mailbox.imapLogin,
    smtpPassword: decryptSecret(mailbox.smtpPasswordEnc),
    imapPassword: decryptSecret(mailbox.imapPasswordEnc),
  });
  const now = new Date();

  if (result.connState !== "ok") {
    const network = result.connState === "unreachable";
    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        connState: "disabled",
        connError: result.error ?? null,
        pausedReason: network
          ? "Почтовый сервер временно недоступен. Повторим проверку автоматически."
          : "Не удалось войти в ящик. Проверьте пароль приложения и переподключите ящик.",
        pauseKind: network ? "NETWORK" : "AUTH",
        connectionIncidentAt: mailbox.connectionIncidentAt ?? now,
        reconnectAttempts: 0,
        nextReconnectAt: network
          ? new Date(now.getTime() + config.mailboxReconnect.baseDelayMs)
          : null,
        lastValidatedAt: now,
      },
    });
    revalidatePath("/app/mailboxes");
    return;
  }

  await prisma.mailbox.updateMany({
    where: { id, userId: user.id },
    data: {
      connState: "ok",
      pausedReason: null,
      pauseKind: null,
      connError: null,
      connectionIncidentAt: null,
      reconnectAttempts: 0,
      nextReconnectAt: null,
      lastValidatedAt: now,
      healthScore: 100,
    },
  });
  revalidatePath("/app/mailboxes");
}
