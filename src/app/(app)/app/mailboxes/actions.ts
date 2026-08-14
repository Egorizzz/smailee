"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { encryptSecret, hasEncKey } from "@/lib/crypto";
import { getProfile } from "@/lib/mail/profiles";
import { validateMailbox } from "@/lib/mail/validate";
import { config } from "@/lib/config";
import type { MailProvider } from "@prisma/client";

type ProvisionInput = {
  userId: string;
  email: string;
  senderName: string;
  provider: MailProvider;
  appPassword: string;
};

// Провижининг одного ящика: домен-группа + валидация (M1: заглушка) +
// шифрование доступов + создание Mailbox. Возвращает ошибку строкой или null.
async function provisionMailbox(input: ProvisionInput): Promise<string | null> {
  const profile = getProfile(input.provider);
  if (!profile) return `Профиль провайдера ${input.provider} пока не поддержан (доступен Яндекс 360)`;

  const email = input.email.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (!domain) return `Некорректный email: ${input.email}`;

  // домен-группа (лимит 120/день на домен)
  const domainGroup = await prisma.domainGroup.upsert({
    where: { userId_domain: { userId: input.userId, domain } },
    update: {},
    create: { userId: input.userId, domain },
  });

  const result = await validateMailbox({
    email,
    smtpHost: profile.smtp.host,
    smtpPort: profile.smtp.port,
    smtpSecurity: profile.smtp.security,
    imapHost: profile.imap.host,
    imapPort: profile.imap.port,
    imapSecurity: profile.imap.security,
    smtpLogin: email,
    imapLogin: email,
    smtpPassword: input.appPassword,
    imapPassword: input.appPassword,
  });

  await prisma.mailbox.upsert({
    where: { userId_email: { userId: input.userId, email } },
    update: {
      senderName: input.senderName,
      provider: input.provider,
      smtpHost: profile.smtp.host,
      smtpPort: profile.smtp.port,
      smtpSecurity: profile.smtp.security,
      smtpLogin: email,
      imapHost: profile.imap.host,
      imapPort: profile.imap.port,
      imapSecurity: profile.imap.security,
      imapLogin: email,
      smtpPasswordEnc: encryptSecret(input.appPassword),
      imapPasswordEnc: encryptSecret(input.appPassword),
      domainGroupId: domainGroup.id,
      connState: result.connState,
      connError: result.error ?? null,
      pausedReason: null,
      pauseKind: result.connState === "unreachable" ? "NETWORK" : result.connState === "auth_error" ? "AUTH" : null,
      connectionIncidentAt: result.connState === "ok" ? null : new Date(),
      reconnectAttempts: 0,
      nextReconnectAt: result.connState === "unreachable"
        ? new Date(Date.now() + config.mailboxReconnect.baseDelayMs)
        : null,
      lastValidatedAt: new Date(),
      spamFolder: profile.spamFolder,
    },
    create: {
      userId: input.userId,
      email,
      senderName: input.senderName,
      provider: input.provider,
      smtpHost: profile.smtp.host,
      smtpPort: profile.smtp.port,
      smtpSecurity: profile.smtp.security,
      smtpLogin: email,
      imapHost: profile.imap.host,
      imapPort: profile.imap.port,
      imapSecurity: profile.imap.security,
      imapLogin: email,
      smtpPasswordEnc: encryptSecret(input.appPassword),
      imapPasswordEnc: encryptSecret(input.appPassword),
      domainGroupId: domainGroup.id,
      connState: result.connState,
      connError: result.error ?? null,
      pauseKind: result.connState === "unreachable" ? "NETWORK" : result.connState === "auth_error" ? "AUTH" : null,
      connectionIncidentAt: result.connState === "ok" ? null : new Date(),
      reconnectAttempts: 0,
      nextReconnectAt: result.connState === "unreachable"
        ? new Date(Date.now() + config.mailboxReconnect.baseDelayMs)
        : null,
      lastValidatedAt: new Date(),
    },
  });

  return null;
}

// Ручное добавление одного ящика.
export async function connectMailbox(formData: FormData): Promise<{ ok?: string; error?: string }> {
  const { owner: user } = await requireCapability("INFRASTRUCTURE_MANAGE");
  if (!hasEncKey()) {
    return { error: "Не задан MAILBOX_ENC_KEY в .env — без него доступы к ящикам не шифруются. Сгенерируйте: openssl rand -hex 32" };
  }

  const provider = (String(formData.get("provider") || "yandex") as MailProvider);
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const senderName = String(formData.get("senderName") || "").trim();
  const appPassword = String(formData.get("appPassword") || "");

  if (!email.includes("@") || !senderName || !appPassword) {
    return { error: "Укажите имя отправителя, email и пароль приложения" };
  }

  const err = await provisionMailbox({ userId: user.id, email, senderName, provider, appPassword });
  revalidatePath("/app/mailboxes");
  if (err) return { error: err };
  return { ok: `Ящик ${email} подключён` };
}

export async function deleteMailbox(formData: FormData) {
  const { owner: user } = await requireCapability("INFRASTRUCTURE_MANAGE");
  const id = String(formData.get("id"));
  await prisma.mailbox.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/app/mailboxes");
}

// Ручная пауза (§5.8) — то же состояние, что и авто-пауза мониторингом
// здоровья (computeFleetHealth), поэтому ящик так же выпадает из ротации
// отправки/приёма/прогрева (connState=disabled ни в одном allow-list M2–M4).
export async function pauseMailbox(formData: FormData) {
  const { owner: user } = await requireCapability("INFRASTRUCTURE_MANAGE");
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

// Возобновить: возврат в "paused" — как только что подключённый ящик, снова
// допущен к ротации, но должен сам подтвердить себя рабочей отправкой/
// поллингом (не сразу "ok"). healthScore сбрасывается — честный новый отсчёт.
export async function resumeMailbox(formData: FormData) {
  const { owner: user } = await requireCapability("INFRASTRUCTURE_MANAGE");
  const id = String(formData.get("id"));
  await prisma.mailbox.updateMany({
    where: { id, userId: user.id },
    data: {
      connState: "paused",
      pausedReason: null,
      pauseKind: null,
      connError: null,
      connectionIncidentAt: null,
      reconnectAttempts: 0,
      nextReconnectAt: null,
      healthScore: 100,
    },
  });
  revalidatePath("/app/mailboxes");
}
