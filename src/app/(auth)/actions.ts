"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  requireUser,
} from "@/lib/auth";
import { issueAuthToken, inspectAuthToken, consumeAuthToken } from "@/lib/authTokens";
import { rateLimit } from "@/lib/rateLimit";
import { sendSystemMail } from "@/lib/systemMail";
import { config } from "@/lib/config";

const loginSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(1, "Введите пароль"),
});

export type AuthState = { error?: string; ok?: string } | undefined;

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

  const email = parsed.data.email.trim().toLowerCase();
  const { password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Неверный email или пароль" };
  }

  await createSession({ userId: user.id, email: user.email });
  if (user.mustChangePassword) redirect("/change-password");
  if (!user.acceptedTermsAt) redirect("/accept-terms");
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

  const allowed = rateLimit(`password-reset:${email}`, { limit: 3, windowMs: 15 * 60 * 1000 });
  const user = allowed ? await prisma.user.findUnique({ where: { email } }) : null;
  if (user && allowed) {
    const token = await issueAuthToken(user.id, "PASSWORD_RESET");
    const url = `${config.appUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
    await sendSystemMail({
      to: user.email,
      subject: "Восстановление пароля Smailee",
      text: `Чтобы задать новый пароль, перейдите по ссылке (она действует 24 часа): ${url}`,
      html: `<p>Чтобы задать новый пароль, перейдите по ссылке:</p><p><a href="${url}">Восстановить пароль</a></p><p>Ссылка действует 24 часа.</p>`,
    });
  }
  return { ok: "Если аккаунт с таким email существует, мы отправили ссылку для восстановления пароля." };
}

export async function setPasswordAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const passwordConfirmation = String(formData.get("passwordConfirmation") || "");
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (password !== passwordConfirmation) return { error: "Пароли не совпадают" };

  const inspected = await inspectAuthToken(token);
  if (!inspected) return { error: "Эта ссылка недействительна или уже использована. Запросите новую." };
  if (!inspected.user.acceptedTermsAt && formData.get("acceptTerms") !== "on") {
    return { error: "Необходимо принять пользовательское соглашение" };
  }
  const record = await consumeAuthToken(token);
  if (!record) return { error: "Эта ссылка недействительна или уже использована. Запросите новую." };

  const user = await prisma.user.update({
    where: { id: record.userId },
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: false,
      acceptedTermsAt: inspected.user.acceptedTermsAt ?? new Date(),
    },
  });
  await prisma.authToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  await createSession({ userId: user.id, email: user.email });
  redirect("/app");
}

export async function changeTemporaryPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const user = await requireUser();
  if (!user.mustChangePassword) redirect("/app");

  const password = String(formData.get("password") || "");
  const passwordConfirmation = String(formData.get("passwordConfirmation") || "");
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (password !== passwordConfirmation) return { error: "Пароли не совпадают" };
  if (await verifyPassword(password, user.passwordHash)) {
    return { error: "Новый пароль должен отличаться от временного" };
  }
  if (!user.acceptedTermsAt && formData.get("acceptTerms") !== "on") {
    return { error: "Необходимо принять пользовательское соглашение" };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
        acceptedTermsAt: user.acceptedTermsAt ?? new Date(),
      },
    }),
    prisma.authToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
  ]);
  redirect("/app");
}

export async function acceptTermsAction(formData: FormData) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");
  if (user.acceptedTermsAt) redirect("/app");
  if (formData.get("acceptTerms") !== "on") redirect("/accept-terms?error=required");

  await prisma.user.update({
    where: { id: user.id },
    data: { acceptedTermsAt: new Date() },
  });
  redirect("/app");
}
