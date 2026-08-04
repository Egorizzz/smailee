"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
} from "@/lib/auth";
import { issueAuthToken, consumeAuthToken } from "@/lib/authTokens";
import { sendSystemMail } from "@/lib/systemMail";
import { config } from "@/lib/config";

const registerSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(6, "Минимум 6 символов"),
  name: z.string().max(200).optional(),
});

const loginSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(1, "Введите пароль"),
});

export type AuthState = { error?: string } | undefined;

export async function registerAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  }

  // оферта обязательна
  if (formData.get("acceptTerms") !== "on") {
    return { error: "Необходимо принять пользовательское соглашение" };
  }

  const { email, password, name } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Пользователь с таким email уже существует" };
  }

  // аккаунт с email из ADMIN_EMAIL автоматически получает роль ADMIN
  const isAdmin =
    process.env.ADMIN_EMAIL &&
    email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        name,
        role: isAdmin ? "ADMIN" : "CLIENT",
        acceptedTermsAt: new Date(),
      },
    });
    const organization = await tx.organization.create({
      data: { name: name?.trim() || email, ownerId: created.id },
    });
    return tx.user.update({
      where: { id: created.id },
      data: { organizationId: organization.id, organizationRole: "ORG_ADMIN" },
    });
  });

  await createSession({ userId: user.id, email: user.email });
  redirect("/app");
}

export async function loginAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Неверный email или пароль" };
  }

  await createSession({ userId: user.id, email: user.email });
  redirect("/app");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

const emailSchema = z.string().email("Введите корректный email");
const passwordSchema = z.string().min(8, "Пароль должен содержать минимум 8 символов");

/** Does not disclose whether the mailbox has an account. */
export async function requestPasswordResetAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!emailSchema.safeParse(email).success) return { error: "Введите корректный email" };

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const token = await issueAuthToken(user.id, "PASSWORD_RESET");
    const url = `${config.appUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
    await sendSystemMail({
      to: user.email,
      subject: "Восстановление пароля Smailee",
      text: `Чтобы задать новый пароль, перейдите по ссылке (она действует 24 часа): ${url}`,
      html: `<p>Чтобы задать новый пароль, перейдите по ссылке:</p><p><a href="${url}">Восстановить пароль</a></p><p>Ссылка действует 24 часа.</p>`,
    });
  }
  return { error: "Если аккаунт с таким email существует, мы отправили ссылку для восстановления пароля." };
}

export async function setPasswordAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const record = await consumeAuthToken(token);
  if (!record) return { error: "Эта ссылка недействительна или уже использована. Запросите новую." };

  const user = await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash: await hashPassword(password) },
  });
  await createSession({ userId: user.id, email: user.email });
  redirect("/app");
}
