"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { sendSystemMail } from "@/lib/systemMail";
import { generateAccountPassword } from "@/lib/accountPassword";
import { adminExtendDemo, adminSetPlan } from "@/server/billing";
import { confirmPayment } from "@/server/billing";
import { provisionDemoClient, replaceWithTemporaryPassword } from "@/server/accountProvisioning";
import type { Plan } from "@prisma/client";
import { issueAuthToken } from "@/lib/authTokens";
import { ensureAdminTelegramPolling, sendAdminTelegramMessage } from "@/lib/services/adminTelegram";
import { hasEncKey } from "@/lib/crypto";
import { provisionMailbox } from "@/server/mailboxProvisioning";

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

const seedMailboxSchema = z.object({
  provider: z.literal("yandex"),
  senderName: z.string().trim().min(1, "Укажите имя отправителя").max(200),
  email: z.string().trim().toLowerCase().email("Укажите корректный email"),
  appPassword: z.string().min(1, "Укажите пароль приложения"),
  confirmedWarm: z.literal("on", {
    error: "Подтвердите, что ящик уже прогрет и не используется в клиентских кампаниях",
  }),
});

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
      "В кабинете уже включён бесплатный доступ к тарифу «Стандартный» на 14 дней.",
      "После входа вы сможете сразу начать работу.",
    ].join("\n"),
    html: [
      "<p>Для вас создан кабинет Smailee.</p>",
      `<p>Логин: <b>${safeEmail}</b><br>Пароль: <code>${safePassword}</code></p>`,
      `<p><a href="${safeLoginUrl}">Войти в Smailee</a></p>`,
      "<p>В кабинете уже включён бесплатный доступ к тарифу «Стандартный» на 14 дней.</p>",
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
  if (!["TRIAL", "BASIC", "START", "PRO"].includes(plan)) return;
  await adminSetPlan(userId, plan);
  revalidatePath("/app/admin");
}

export async function adminExtendClientDemo(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") || "");
  await adminExtendDemo(userId);
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

export async function adminConnectSeedMailbox(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const admin = await requireAdmin();
  if (!hasEncKey()) {
    return { error: "Не задан MAILBOX_ENC_KEY — без него доступы к ящику нельзя сохранить безопасно" };
  }

  const parsed = seedMailboxSchema.safeParse({
    provider: String(formData.get("provider") || "yandex"),
    senderName: formData.get("senderName"),
    email: formData.get("email"),
    appPassword: formData.get("appPassword"),
    confirmedWarm: formData.get("confirmedWarm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  }

  const error = await provisionMailbox({
    userId: admin.id,
    email: parsed.data.email,
    senderName: parsed.data.senderName,
    provider: parsed.data.provider,
    appPassword: parsed.data.appPassword,
    mode: "seed",
  });
  revalidatePath("/app/admin");
  revalidatePath("/app/mailboxes");
  if (error) return { error };
  return { ok: `Служебный seed ${parsed.data.email} подключён` };
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

const ADMIN_TELEGRAM_CONNECT_TTL_MS = 15 * 60_000;

export async function createAdminTelegramConnectLink(): Promise<{ url?: string; error?: string }> {
  const admin = await requireAdmin();
  if (!config.adminTelegram.botToken) {
    return { error: "Сначала задайте TELEGRAM_ADMIN_BOT_TOKEN в окружении приложения" };
  }
  try {
    const { username } = await ensureAdminTelegramPolling();
    const token = await issueAuthToken(
      admin.id,
      "ADMIN_TELEGRAM_CONNECT",
      ADMIN_TELEGRAM_CONNECT_TTL_MS,
      { replaceExisting: false },
    );
    return { url: `https://t.me/${username}?start=${token}` };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Не удалось создать ссылку подключения",
    };
  }
}

export async function revokeAdminTelegramRecipient(formData: FormData) {
  await requireAdmin();
  const recipientId = String(formData.get("recipientId") || "");
  const recipient = await prisma.adminTelegramRecipient.findFirst({
    where: { id: recipientId, revokedAt: null },
    select: { id: true, chatId: true },
  });
  if (!recipient) return;

  const now = new Date();
  await prisma.$transaction([
    prisma.adminTelegramRecipient.update({
      where: { id: recipient.id },
      data: { revokedAt: now },
    }),
    prisma.adminTelegramDelivery.updateMany({
      where: { recipientId: recipient.id, sentAt: null, discardedAt: null },
      data: { discardedAt: now, lastError: "Доступ отозван администратором" },
    }),
  ]);
  if (config.adminTelegram.botToken) {
    await sendAdminTelegramMessage(
      recipient.chatId,
      "Доступ к служебным уведомлениям Smailee отозван администратором.",
    ).catch(() => undefined);
  }
  revalidatePath("/app/admin");
}
