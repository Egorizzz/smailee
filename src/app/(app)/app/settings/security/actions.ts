"use server";

import { z } from "zod";
import { requireUser, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { issueAuthToken } from "@/lib/authTokens";
import { sendSystemMail } from "@/lib/systemMail";
import { config } from "@/lib/config";

export type CredentialState = { error?: string; ok?: string } | undefined;
const emailSchema = z.string().trim().toLowerCase().email("Укажите корректный email");
const passwordSchema = z.string().min(8, "Пароль должен содержать минимум 8 символов").max(128, "Пароль слишком длинный");

export async function requestPasswordChange(_previous: CredentialState, formData: FormData): Promise<CredentialState> {
  const user = await requireUser();
  const password = String(formData.get("password") || "");
  const confirmation = String(formData.get("passwordConfirmation") || "");
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (password !== confirmation) return { error: "Пароли не совпадают." };
  const expiresAt = new Date(Date.now() + 86_400_000);
  const newPasswordHash = await hashPassword(password);
  await prisma.accountCredentialChange.upsert({
    where: { userId: user.id },
    create: { userId: user.id, newPasswordHash, expiresAt },
    update: { newPasswordHash, expiresAt, createdAt: new Date() },
  });
  const token = await issueAuthToken(user.id, "CREDENTIAL_CHANGE", 86_400_000, { verifiesEmail: true });
  const url = `${config.appUrl.replace(/\/$/, "")}/confirm-credentials?token=${encodeURIComponent(token)}`;
  const sent = await sendSystemMail({ to: user.email, subject: "Подтвердите пароль Smailee", text: `Подтвердите установку нового пароля: ${url}`, html: `<p><a href="${url}">Подтвердить новый пароль</a></p><p>Ссылка действует 24 часа.</p>` });
  return sent.ok ? { ok: `Письмо отправлено на ${user.email}.` } : { error: "Не удалось отправить письмо. Повторите позже." };
}

export async function requestEmailChange(_previous: CredentialState, formData: FormData): Promise<CredentialState> {
  const user = await requireUser();
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (parsed.data === user.email.toLowerCase()) return { error: "Это уже текущий email." };
  if (await prisma.user.findUnique({ where: { email: parsed.data }, select: { id: true } })) return { error: "Этот email уже используется." };
  const expiresAt = new Date(Date.now() + 86_400_000);
  await prisma.accountEmailChange.upsert({ where: { userId: user.id }, create: { userId: user.id, newEmail: parsed.data, expiresAt }, update: { newEmail: parsed.data, expiresAt, createdAt: new Date() } });
  const token = await issueAuthToken(user.id, "EMAIL_CHANGE", 86_400_000);
  const url = `${config.appUrl.replace(/\/$/, "")}/confirm-email?token=${encodeURIComponent(token)}`;
  const sent = await sendSystemMail({ to: parsed.data, subject: "Подтвердите новый email Smailee", text: `Подтвердите новый email для входа: ${url}`, html: `<p><a href="${url}">Подтвердить новый email</a></p><p>Ссылка действует 24 часа.</p>` });
  return sent.ok ? { ok: `Письмо отправлено на ${parsed.data}.` } : { error: "Не удалось отправить письмо. Повторите позже." };
}

export async function resendEmailVerification(_previous: CredentialState): Promise<CredentialState> {
  const user = await requireUser();
  if (user.emailVerifiedAt) return { ok: "Email уже подтверждён." };
  const token = await issueAuthToken(user.id, "EMAIL_LOGIN", 1_800_000, { verifiesEmail: true });
  const url = `${config.appUrl.replace(/\/$/, "")}/access?token=${encodeURIComponent(token)}`;
  const sent = await sendSystemMail({ to: user.email, subject: "Подтвердите email Smailee", text: `Подтвердить email и войти: ${url}`, html: `<p><a href="${url}">Подтвердить email</a></p><p>Ссылка действует 30 минут.</p>` });
  return sent.ok ? { ok: `Письмо отправлено на ${user.email}.` } : { error: "Не удалось отправить письмо. Повторите позже." };
}
