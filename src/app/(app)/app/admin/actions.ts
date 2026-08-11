"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { sendSystemMail } from "@/lib/systemMail";
import { generateAccountPassword } from "@/lib/accountPassword";
import { adminSetPlan } from "@/server/billing";
import { confirmPayment } from "@/server/billing";
import { provisionDemoClient, replaceWithTemporaryPassword } from "@/server/accountProvisioning";
import type { Plan } from "@prisma/client";

export type AdminActionState = {
  error?: string;
  ok?: string;
  temporaryPassword?: string;
} | undefined;

const createClientSchema = z.object({
  email: z.string().trim().toLowerCase().email("Укажите корректный email"),
  name: z.string().trim().max(200).optional(),
  companyName: z.string().trim().max(200).optional(),
});

const manualPasswordSchema = z.string()
  .min(8, "Временный пароль должен содержать минимум 8 символов")
  .max(128, "Временный пароль слишком длинный");

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

async function sendInitialAccessEmail(email: string, password: string) {
  const loginUrl = `${config.appUrl.replace(/\/$/, "")}/login`;
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(password);
  const safeLoginUrl = escapeHtml(loginUrl);
  return sendSystemMail({
    to: email,
    subject: "Доступ в Smailee",
    text: [
      "Для вас создан кабинет Smailee.",
      `Логин: ${email}`,
      `Пароль: ${password}`,
      `Войти: ${loginUrl}`,
      "После входа вы сможете сразу начать работу.",
    ].join("\n"),
    html: [
      "<p>Для вас создан кабинет Smailee.</p>",
      `<p>Логин: <b>${safeEmail}</b><br>Пароль: <code>${safePassword}</code></p>`,
      `<p><a href="${safeLoginUrl}">Войти в Smailee</a></p>`,
      "<p>После входа вы сможете сразу начать работу.</p>",
    ].join(""),
  });
}

// A2: админ создаёт ЛК для клиента
export async function adminCreateClient(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  await requireAdmin();
  const parsed = createClientSchema.safeParse({
    email: formData.get("email"),
    name: String(formData.get("name") || "") || undefined,
    companyName: String(formData.get("companyName") || "") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };

  const { email } = parsed.data;
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return { error: "Пользователь с таким email уже существует" };

  const initialPassword = generateAccountPassword();
  let user;
  try {
    user = await provisionDemoClient({
      email,
      name: parsed.data.name || null,
      companyName: parsed.data.companyName || null,
      initialPassword,
    });
  } catch (error) {
    console.error("[admin] failed to provision client", error);
    return { error: "Не удалось создать кабинет. Проверьте, не появился ли пользователь с таким email, и повторите попытку." };
  }

  const sent = await sendInitialAccessEmail(user.email, initialPassword);

  revalidatePath("/app/admin");
  return {
    ok: sent.ok
      ? `Кабинет создан, доступ отправлен на ${user.email}.`
      : `Кабинет создан, но письмо не отправлено: ${sent.error}. Задайте пользователю временный пароль в таблице клиентов.`,
  };
}

export async function adminSetTemporaryPassword(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") || "");
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });
  if (!target || target.role !== "CLIENT") return { error: "Пользователь не найден или его пароль нельзя менять из этой формы." };
  if (target.id === admin.id) return { error: "Нельзя заменить собственный пароль этой формой." };

  const temporaryPassword = String(formData.get("temporaryPassword") || "");
  const parsed = manualPasswordSchema.safeParse(temporaryPassword);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const updated = await replaceWithTemporaryPassword(target.id, parsed.data);
  if (!updated) return { error: "Не удалось заменить пароль пользователя." };
  revalidatePath("/app/admin");
  return {
    ok: `Временный пароль для ${target.email} установлен. Передайте его пользователю вручную — после входа он должен будет задать новый.`,
    temporaryPassword: parsed.data,
  };
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

// Сброс прогрева ящика на ноль (устраняет последствия найденного бага: переход
// в "warm" раньше считался только по календарному времени, без проверки, что
// реально хоть что-то отправилось — ящик без пиров мог "простоять" ramp
// впустую и получить warm за 0 отправленных писем; движок это больше не
// допускает, но уже проставленное состояние старых ящиков сам не откатывает).
// Нужно, когда хочешь честно перепройти ramp с нуля — напр. после тестового
// прогона с ускоренным WARMUP_DAY_MS.
export async function adminResetWarmup(formData: FormData) {
  await requireAdmin();
  const mailboxId = String(formData.get("mailboxId"));
  await prisma.mailbox.update({
    where: { id: mailboxId },
    data: {
      warmupState: "off",
      warmupStartedAt: null,
      warmupDay: 0,
      warmupSentToday: 0,
      warmupSentDate: null,
    },
  });
  revalidatePath("/app/admin");
}
