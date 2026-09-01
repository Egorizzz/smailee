"use server";

import { z } from "zod";
import { requireUser, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { issueAuthToken } from "@/lib/authTokens";
import { sendSystemMail } from "@/lib/systemMail";
import { config } from "@/lib/config";

export type CredentialState = { error?: string; ok?: string } | undefined;

const loginSchema = z.string().trim().toLowerCase()
  .min(4, "Логин должен содержать минимум 4 символа")
  .max(40, "Логин должен содержать не больше 40 символов")
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Используйте латинские буквы, цифры, точку, дефис или подчёркивание");
const passwordSchema = z.string().min(8, "Пароль должен содержать минимум 8 символов").max(128, "Пароль слишком длинный");

export async function requestCredentialChange(
  _previous: CredentialState,
  formData: FormData,
): Promise<CredentialState> {
  const user = await requireUser();
  if (user.emailPending) return { error: "Сначала добавьте рабочий email в онбординге." };

  const loginValue = String(formData.get("login") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const passwordConfirmation = String(formData.get("passwordConfirmation") || "");
  let newLogin: string | null = null;
  let newPasswordHash: string | null = null;

  if (loginValue && loginValue !== user.login) {
    const parsedLogin = loginSchema.safeParse(loginValue);
    if (!parsedLogin.success) return { error: parsedLogin.error.issues[0]?.message };
    const occupied = await prisma.user.findFirst({
      where: { OR: [{ login: parsedLogin.data }, { email: parsedLogin.data }] },
      select: { id: true },
    });
    if (occupied && occupied.id !== user.id) return { error: "Этот логин уже занят." };
    newLogin = parsedLogin.data;
  }

  if (password) {
    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedPassword.success) return { error: parsedPassword.error.issues[0]?.message };
    if (password !== passwordConfirmation) return { error: "Пароли не совпадают." };
    newPasswordHash = await hashPassword(password);
  }

  if (!newLogin && !newPasswordHash) return { error: "Укажите новый логин или новый пароль." };

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.accountCredentialChange.upsert({
    where: { userId: user.id },
    create: { userId: user.id, newLogin, newPasswordHash, expiresAt },
    update: { newLogin, newPasswordHash, expiresAt, createdAt: new Date() },
  });
  const token = await issueAuthToken(user.id, "CREDENTIAL_CHANGE");
  const url = `${config.appUrl.replace(/\/$/, "")}/confirm-credentials?token=${encodeURIComponent(token)}`;
  const changed = [newLogin ? `логин на ${newLogin}` : null, newPasswordHash ? "пароль" : null].filter(Boolean).join(" и ");
  const sent = await sendSystemMail({
    to: user.email,
    subject: "Подтвердите изменение доступа в Smailee",
    text: `Вы запросили изменение: ${changed}. Подтвердите его по ссылке в течение 24 часов: ${url}\n\nЕсли это были не вы, ничего не делайте.`,
    html: `<p>Вы запросили изменение: <b>${changed}</b>.</p><p><a href="${url}">Подтвердить изменение</a></p><p>Ссылка действует 24 часа. Если это были не вы, ничего не делайте.</p>`,
  });
  if (!sent.ok) {
    console.error("[security] failed to send credential confirmation", sent.error);
    return { error: "Не удалось отправить письмо с подтверждением. Повторите позже." };
  }
  return { ok: `Письмо с подтверждением отправлено на ${user.email}.` };
}
