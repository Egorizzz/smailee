"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret, hasEncKey } from "@/lib/crypto";
import { getProfile } from "@/lib/mail/profiles";
import { validateMailbox } from "@/lib/mail/validate";
import { parseMailboxCsv } from "@/lib/mail/csv";
import type { MailProvider } from "@prisma/client";

type ProvisionInput = {
  userId: string;
  email: string;
  senderName: string;
  provider: MailProvider;
  smtpPassword: string;
  imapPassword: string;
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
    imapHost: profile.imap.host,
    imapPort: profile.imap.port,
    smtpLogin: email,
    imapLogin: email,
    smtpPassword: input.smtpPassword,
    imapPassword: input.imapPassword,
  });

  await prisma.mailbox.upsert({
    where: { userId_email: { userId: input.userId, email } },
    update: {
      senderName: input.senderName || email,
      provider: input.provider,
      smtpHost: profile.smtp.host,
      smtpPort: profile.smtp.port,
      smtpSecurity: profile.smtp.security,
      smtpLogin: email,
      imapHost: profile.imap.host,
      imapPort: profile.imap.port,
      imapSecurity: profile.imap.security,
      imapLogin: email,
      smtpPasswordEnc: encryptSecret(input.smtpPassword),
      imapPasswordEnc: encryptSecret(input.imapPassword),
      domainGroupId: domainGroup.id,
      connState: result.connState,
      connError: result.error ?? null,
      lastValidatedAt: new Date(),
      spamFolder: profile.spamFolder,
    },
    create: {
      userId: input.userId,
      email,
      senderName: input.senderName || email,
      provider: input.provider,
      smtpHost: profile.smtp.host,
      smtpPort: profile.smtp.port,
      smtpSecurity: profile.smtp.security,
      smtpLogin: email,
      imapHost: profile.imap.host,
      imapPort: profile.imap.port,
      imapSecurity: profile.imap.security,
      imapLogin: email,
      smtpPasswordEnc: encryptSecret(input.smtpPassword),
      imapPasswordEnc: encryptSecret(input.imapPassword),
      domainGroupId: domainGroup.id,
      connState: result.connState,
      connError: result.error ?? null,
      lastValidatedAt: new Date(),
    },
  });

  return null;
}

// Ручное добавление одного ящика.
export async function connectMailbox(formData: FormData): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  if (!hasEncKey()) {
    return { error: "Не задан MAILBOX_ENC_KEY в .env — без него доступы к ящикам не шифруются. Сгенерируйте: openssl rand -hex 32" };
  }

  const provider = (String(formData.get("provider") || "yandex") as MailProvider);
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const senderName = String(formData.get("senderName") || "").trim();
  const smtpPassword = String(formData.get("smtpPassword") || "");
  const imapPassword = String(formData.get("imapPassword") || "");

  if (!email.includes("@") || !smtpPassword || !imapPassword) {
    return { error: "Укажите email и пароли SMTP/IMAP (пароль приложения провайдера)" };
  }

  const err = await provisionMailbox({ userId: user.id, email, senderName, provider, smtpPassword, imapPassword });
  revalidatePath("/app/mailboxes");
  if (err) return { error: err };
  return { ok: `Ящик ${email} подключён` };
}

// Импорт пула ящиков из CSV.
export async function importMailboxesCsv(formData: FormData): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  if (!hasEncKey()) {
    return { error: "Не задан MAILBOX_ENC_KEY в .env — сгенерируйте: openssl rand -hex 32" };
  }
  const provider = (String(formData.get("provider") || "yandex") as MailProvider);
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Прикрепите CSV-файл" };

  const rows = parseMailboxCsv(await file.text());
  if (rows.length === 0) return { error: "В CSV не найдено ящиков (нужна колонка email)" };

  let ok = 0;
  const errors: string[] = [];
  for (const r of rows) {
    if (!r.smtpPassword || !r.imapPassword) {
      errors.push(`${r.email}: нет SMTP/IMAP-пароля`);
      continue;
    }
    const err = await provisionMailbox({
      userId: user.id,
      email: r.email,
      senderName: r.senderName,
      provider,
      smtpPassword: r.smtpPassword,
      imapPassword: r.imapPassword,
    });
    if (err) errors.push(err);
    else ok++;
  }
  revalidatePath("/app/mailboxes");
  return {
    ok: `Подключено ящиков: ${ok}${errors.length ? `. Ошибок: ${errors.length} — ${errors.slice(0, 3).join("; ")}` : ""}`,
  };
}

export async function deleteMailbox(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  await prisma.mailbox.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/app/mailboxes");
}
