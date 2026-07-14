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

// A5 (ручной сценарий): подтвердить платёж без шлюза
export async function adminConfirmPayment(formData: FormData) {
  await requireAdmin();
  const paymentId = String(formData.get("paymentId"));
  await confirmPayment(paymentId);
  revalidatePath("/app/admin");
  revalidatePath("/app/billing");
}

// Пометить/снять ящик как seed-пул (§5.6, §9.1): seed-ящики оператор заводит
// вне кода, а этим тумблером включает в кросс-клиентскую сеть прогрева
// (движок всегда добавляет их в пиринг независимо от клиента и ramp-гейта).
export async function adminToggleSeed(formData: FormData) {
  await requireAdmin();
  const mailboxId = String(formData.get("mailboxId"));
  const makeSeed = formData.get("makeSeed") === "1";
  await prisma.mailbox.update({
    where: { id: mailboxId },
    data: { isSeed: makeSeed },
  });
  revalidatePath("/app/admin");
}
