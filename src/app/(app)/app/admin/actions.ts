"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { adminSetPlan } from "@/server/billing";
import { confirmPayment } from "@/server/billing";
import type { Plan } from "@prisma/client";

export type AdminActionState = { error?: string; ok?: string } | undefined;

// A2: админ создаёт ЛК для клиента
export async function adminCreateClient(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const name = String(formData.get("name") || "") || null;
  const plan = (String(formData.get("plan") || "TRIAL") as Plan) ?? "TRIAL";

  if (!email.includes("@") || password.length < 6) {
    return { error: "Укажите корректный email и пароль от 6 символов" };
  }
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return { error: "Пользователь с таким email уже существует" };

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      name,
      plan,
      planExpiresAt:
        plan === "TRIAL" ? null : new Date(Date.now() + 30 * 24 * 3600 * 1000),
      acceptedTermsAt: new Date(), // онбордим вручную — оферта принята при передаче доступа
    },
  });

  revalidatePath("/app/admin");
  return { ok: `Кабинет создан: ${user.email} (передайте клиенту пароль)` };
}

// A4: смена тарифа клиента
export async function adminChangePlan(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId"));
  const plan = String(formData.get("plan")) as Plan;
  if (!["TRIAL", "START", "PRO"].includes(plan)) return;
  await adminSetPlan(userId, plan);
  revalidatePath("/app/admin");
}

// Привязка API-ключа изолированного Project'а клиента в Unisender Go —
// Project заводится вручную в ЛК Unisender (см. docs/unisender-project-setup.md),
// сюда только вставляется готовый ключ. Пустое значение снимает привязку
// (клиент откатывается на общий аккаунт).
export async function adminSetUnisenderKey(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId"));
  const apiKey = String(formData.get("unisenderApiKey") || "").trim();
  await prisma.user.update({
    where: { id: userId },
    data: { unisenderApiKey: apiKey || null },
  });
  revalidatePath("/app/admin");
}

// A5 (ручной сценарий): подтвердить платёж без шлюза
export async function adminConfirmPayment(formData: FormData) {
  await requireAdmin();
  const paymentId = String(formData.get("paymentId"));
  await confirmPayment(paymentId);
  revalidatePath("/app/admin");
  revalidatePath("/app/billing");
}
