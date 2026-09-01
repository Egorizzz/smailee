"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { sendSystemMail } from "@/lib/systemMail";
import { generateAccountPassword } from "@/lib/accountPassword";
import { adminSetPlan, expirePendingPayments, repairPaidPlanExpiry } from "@/server/billing";
import { provisionTrialClient } from "@/server/accountProvisioning";
import type { Plan } from "@prisma/client";
import { issueAuthToken } from "@/lib/authTokens";
import { inspectAuthToken } from "@/lib/authTokens";
import { ensureAdminTelegramPolling, sendAdminTelegramMessage } from "@/lib/services/adminTelegram";
import { hasEncKey } from "@/lib/crypto";
import { provisionMailbox } from "@/server/mailboxProvisioning";

export type AdminActionState = {
  error?: string;
  ok?: string;
  accessMessage?: string;
} | undefined;

const createClientSchema = z.object({
  email: z.string().trim().toLowerCase().email("Укажите корректный email"),
  name: z.string().trim().max(200).optional(),
  companyName: z.string().trim().max(200).optional(),
  delivery: z.enum(["email", "copy"]),
});

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

function initialAccessText(accessUrl: string) {
  return [
    "Для вас создан кабинет Smailee.",
    `Войти: ${accessUrl}`,
    "После входа пароль можно добавить по желанию в разделе «Вход и безопасность».",
    "В кабинете включён бессрочный пробный тариф: 5 контактов, 50 отправок и один почтовый ящик.",
    "Ссылка действует 7 дней и используется один раз.",
  ].join("\n");
}

async function sendInitialAccessEmail(email: string, accessUrl: string) {
  const safeAccessUrl = escapeHtml(accessUrl);
  return sendSystemMail({
    to: email,
    subject: "Доступ в Smailee",
    text: initialAccessText(accessUrl),
    html: [
      "<p>Для вас создан кабинет Smailee.</p>",
      `<p><a href="${safeAccessUrl}">Войти в кабинет</a></p>`,
      "<p>После входа пароль можно добавить по желанию в разделе «Вход и безопасность».</p>",
      "<p>В кабинете включён бессрочный пробный тариф: 5 контактов, 50 отправок и один почтовый ящик.</p>",
      "<p>Ссылка действует 7 дней и используется один раз.</p>",
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
    delivery: formData.get("delivery"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };

  const email = parsed.data.email;
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return { error: "Пользователь с таким email уже существует" };

  const initialPassword = generateAccountPassword();
  let user;
  try {
    user = await provisionTrialClient({
      email,
      name: parsed.data.name || null,
      companyName: parsed.data.companyName || null,
      initialPassword,
    });
  } catch (error) {
    console.error("[admin] failed to provision client", error);
    return { error: "Не удалось создать кабинет. Проверьте, не появился ли пользователь с таким email, и повторите попытку." };
  }

  let token = await issueAuthToken(user.id, "INITIAL_ACCESS", 7 * 24 * 60 * 60 * 1000, {
    verifiesEmail: parsed.data.delivery === "email",
  });
  let accessUrl = `${config.appUrl.replace(/\/$/, "")}/access?token=${encodeURIComponent(token)}`;
  let sent = parsed.data.delivery === "email" ? await sendInitialAccessEmail(email, accessUrl) : null;
  if (parsed.data.delivery === "email" && !sent?.ok) {
    const failedToken = await inspectAuthToken(token);
    if (failedToken) await prisma.authToken.delete({ where: { id: failedToken.id } });
    token = await issueAuthToken(user.id, "INITIAL_ACCESS", 7 * 24 * 60 * 60 * 1000, { verifiesEmail: false });
    accessUrl = `${config.appUrl.replace(/\/$/, "")}/access?token=${encodeURIComponent(token)}`;
  }
  const accessMessage = initialAccessText(accessUrl);

  revalidatePath("/app/admin");
  return {
    ok: parsed.data.delivery === "copy"
      ? "Кабинет создан. Скопируйте сообщение и отправьте его клиенту."
      : sent?.ok
        ? `Кабинет создан, ссылка отправлена на ${email}.`
        : `Кабинет создан, но письмо не отправлено: ${sent?.error}. Скопируйте сообщение и отправьте его вручную.`,
    accessMessage: parsed.data.delivery === "copy" || !sent?.ok ? accessMessage : undefined,
  };
}

export async function adminCreateMessengerAccess(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdmin();
  const userId = String(formData.get("userId") || "");
  const user = await prisma.user.findFirst({ where: { id: userId, role: "CLIENT" }, select: { id: true } });
  if (!user) return { error: "Клиент не найден." };
  const token = await issueAuthToken(user.id, "INITIAL_ACCESS", 7 * 24 * 60 * 60 * 1000, {
    replaceExisting: false,
    verifiesEmail: false,
  });
  const accessUrl = `${config.appUrl.replace(/\/$/, "")}/access?token=${encodeURIComponent(token)}`;
  return { ok: "Ссылка готова.", accessMessage: initialAccessText(accessUrl) };
}

// A4: смена тарифа клиента
export async function adminChangePlan(formData: FormData) {
  await requireAdmin();
  await expirePendingPayments();
  const userId = String(formData.get("userId"));
  const plan = String(formData.get("plan")) as Plan;
  if (!["TRIAL", "BASIC", "START", "PRO"].includes(plan)) return;
  const pendingPayment = await prisma.payment.findFirst({
    where: { userId, status: "PENDING" },
    select: { id: true },
  });
  if (pendingPayment) return;
  await adminSetPlan(userId, plan);
  revalidatePath("/app/admin");
}

export async function adminRepairPlanExpiry(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") || "");
  if (!userId) return;
  await repairPaidPlanExpiry(userId);
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
