import type { Plan, PlanNotification, PlanNotificationKind, Prisma, User } from "@prisma/client";
import { config } from "@/lib/config";
import { isPlanActive, PLANS } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { sendSystemMail, type SystemMail } from "@/lib/systemMail";

const DAY = 86_400_000;
const MAX_BATCH = 20;

type NotificationUser = Pick<
  User,
  "id" | "email" | "name" | "organizationId" | "organizationRole" | "plan" | "planExpiresAt" | "isDemo"
>;

type Stage = {
  kind: PlanNotificationKind;
  offsetDays: number;
  validForDays: number | null;
  requiresExpiryMatch: boolean;
};

type PlanNotificationDb = Pick<Prisma.TransactionClient, "planNotification">;

const DEMO_STAGES: Stage[] = [
  { kind: "DEMO_ENDS_3D", offsetDays: -3, validForDays: 2, requiresExpiryMatch: true },
  { kind: "DEMO_ENDS_1D", offsetDays: -1, validForDays: 1, requiresExpiryMatch: true },
];

const EXPIRY_STAGES: Stage[] = [
  { kind: "PLAN_DISABLED", offsetDays: 0, validForDays: null, requiresExpiryMatch: true },
  { kind: "RETURN_3D", offsetDays: 3, validForDays: 7, requiresExpiryMatch: true },
  { kind: "RETURN_10D", offsetDays: 10, validForDays: 20, requiresExpiryMatch: true },
  { kind: "RETURN_30D", offsetDays: 30, validForDays: 7, requiresExpiryMatch: true },
];

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY);
}

function cycleKey(planEndsAt: Date, manual = false) {
  return `${manual ? "manual:" : "expiry:"}${planEndsAt.toISOString()}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

function formatDate(value: Date) {
  return value.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  });
}

function greeting(user: NotificationUser) {
  return user.name?.trim() ? `Здравствуйте, ${user.name.trim()}!` : "Здравствуйте!";
}

function billingUrl() {
  return `${config.appUrl.replace(/\/$/, "")}/app/billing`;
}

function messageFor(notification: PlanNotification, user: NotificationUser): Omit<SystemMail, "to"> {
  const hello = greeting(user);
  const date = formatDate(notification.planEndsAt);
  const link = billingUrl();
  const planName = PLANS[notification.plan].name;
  let subject: string;
  let paragraphs: string[];
  let action: string;
  let from: string | undefined;

  switch (notification.kind) {
    case "DEMO_ENDS_3D":
      subject = "До окончания демо Smailee осталось 3 дня";
      paragraphs = [
        "Через 3 дня закончится бесплатный доступ к тарифу «Стандартный».",
        `После ${date} отправка кампаний и follow-up будет приостановлена, но ваши данные останутся в кабинете.`,
      ];
      action = "Продолжить работу:";
      break;
    case "DEMO_ENDS_1D":
      subject = "Демо Smailee закончится завтра";
      paragraphs = [
        "Завтра заканчивается ваш бесплатный доступ к тарифу «Стандартный».",
        "После завершения демо отправка писем будет приостановлена. Контакты, кампании, переписки и письма в очереди сохранятся.",
      ];
      action = "Выбрать тариф:";
      break;
    case "PLAN_DISABLED":
      subject = "Доступ к Smailee приостановлен";
      paragraphs = [
        `Срок действия тарифа «${planName}» завершён, поэтому отправка кампаний и follow-up приостановлена.`,
        "Ваши контакты, кампании, переписки и очередь писем сохранены. После подключения тарифа работа продолжится.",
      ];
      action = "Возобновить доступ:";
      break;
    case "RETURN_3D":
      subject = "Помочь вам вернуться в Smailee?";
      paragraphs = [
        "Три дня назад доступ к Smailee был приостановлен.",
        "Если продолжить работу помешал вопрос по тарифу, настройке или запуску рассылок — просто ответьте на это письмо. Мы поможем разобраться.",
      ];
      action = "Вернуться в кабинет:";
      from = config.systemMail.infoFrom;
      break;
    case "RETURN_10D":
      subject = "Что помешало продолжить работу со Smailee?";
      paragraphs = [
        "Хотим понять, почему вы решили пока не продолжать работу со Smailee.",
        "Будем благодарны за короткий ответ на это письмо — даже одного предложения достаточно. Если нужна помощь с настройкой или выбором тарифа, мы подключимся.",
      ];
      action = "Возобновить доступ:";
      from = config.systemMail.infoFrom;
      break;
    case "RETURN_30D":
      subject = "Вернуться в Smailee можно в любой момент";
      paragraphs = [
        "Ваш кабинет и данные по-прежнему сохранены. Вы можете вернуться к работе со Smailee в любой момент — контакты, кампании и переписки останутся на месте.",
        "Если перед возвращением нужна консультация, ответьте на это письмо.",
      ];
      action = "Открыть Smailee:";
      from = config.systemMail.infoFrom;
      break;
  }

  const text = [hello, "", ...paragraphs.flatMap((paragraph) => [paragraph, ""]), action, link].join("\n");
  const html = [
    `<p>${escapeHtml(hello)}</p>`,
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    `<p>${escapeHtml(action)}<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
  ].join("");
  return {
    subject,
    text,
    html,
    ...(from ? { from, replyTo: from } : {}),
  };
}

async function organizationAdminEmails(user: NotificationUser) {
  if (!user.organizationId) {
    return user.organizationRole === "ORG_ADMIN" ? [user.email] : [];
  }
  const admins = await prisma.user.findMany({
    where: { organizationId: user.organizationId, organizationRole: "ORG_ADMIN" },
    select: { email: true },
  });
  return [...new Set(admins.map((admin) => admin.email))];
}

async function createCycle(input: {
  userId: string;
  plan: Plan;
  wasDemo: boolean;
  planEndsAt: Date;
  stages: Stage[];
  manual?: boolean;
  now: Date;
}, db: PlanNotificationDb = prisma) {
  const key = cycleKey(input.planEndsAt, input.manual);
  await db.planNotification.updateMany({
    where: { userId: input.userId, sentAt: null, canceledAt: null, cycleKey: { not: key } },
    data: { canceledAt: input.now },
  });
  await db.planNotification.createMany({
    data: input.stages.map((stage) => {
      const scheduledAt = addDays(input.planEndsAt, stage.offsetDays);
      return {
        userId: input.userId,
        kind: stage.kind,
        cycleKey: key,
        plan: input.plan,
        wasDemo: input.wasDemo,
        planEndsAt: input.planEndsAt,
        requiresExpiryMatch: input.manual ? false : stage.requiresExpiryMatch,
        scheduledAt,
        validUntil: stage.validForDays === null ? null : addDays(scheduledAt, stage.validForDays),
        nextAttemptAt: scheduledAt,
      };
    }),
    skipDuplicates: true,
  });
  return key;
}

/** Отменяет все ещё не отправленные этапы после покупки, продления или смены тарифа. */
export async function cancelPendingPlanNotifications(
  userId: string,
  now = new Date(),
  db: PlanNotificationDb = prisma,
) {
  return db.planNotification.updateMany({
    where: { userId, sentAt: null, canceledAt: null },
    data: { canceledAt: now },
  });
}

/** Немедленная приостановка администратором — отдельный цикл от момента действия. */
export async function scheduleManualPlanDisabled(input: {
  userId: string;
  previousPlan: Plan;
  wasDemo: boolean;
  now?: Date;
}, db: PlanNotificationDb = prisma) {
  const now = input.now ?? new Date();
  return createCycle({
    userId: input.userId,
    plan: input.previousPlan,
    wasDemo: input.wasDemo,
    planEndsAt: now,
    stages: EXPIRY_STAGES,
    manual: true,
    now,
  }, db);
}

/**
 * Обнаруживает все тарифы с известным сроком. Дедупликация
 * по user + срок + этап делает вызов безопасным для каждого тика и реплики.
 */
export async function syncPlanNotifications(now = new Date()) {
  const users = await prisma.user.findMany({
    where: {
      role: "CLIENT",
      plan: { not: "TRIAL" },
      planExpiresAt: { not: null },
    },
    select: { id: true, plan: true, planExpiresAt: true, isDemo: true },
  });

  for (const user of users) {
    const planEndsAt = user.planExpiresAt!;
    const expired = planEndsAt <= now;
    const stages = user.isDemo ? [...DEMO_STAGES, ...EXPIRY_STAGES] : EXPIRY_STAGES;
    await createCycle({
      userId: user.id,
      plan: user.plan,
      wasDemo: user.isDemo,
      planEndsAt,
      stages,
      now,
    });
    if (expired) {
      await prisma.planNotification.updateMany({
        where: {
          userId: user.id,
          cycleKey: cycleKey(planEndsAt),
          kind: { in: ["DEMO_ENDS_3D", "DEMO_ENDS_1D"] },
          sentAt: null,
          canceledAt: null,
        },
        data: { canceledAt: now },
      });
    }
  }
  return users.length;
}

function retryDelay(attempt: number) {
  return Math.min(
    config.planNotifications.retryMaxMs,
    config.planNotifications.retryBaseMs * 2 ** Math.max(0, attempt - 1),
  );
}

function isDemoReminder(kind: PlanNotificationKind) {
  return kind === "DEMO_ENDS_3D" || kind === "DEMO_ENDS_1D";
}

function isStillValid(notification: PlanNotification, user: NotificationUser, now: Date) {
  if (notification.validUntil && notification.validUntil <= now) return false;
  const active = isPlanActive(user.plan, user.planExpiresAt, now);
  const matchesExpiry = user.planExpiresAt?.getTime() === notification.planEndsAt.getTime();
  if (isDemoReminder(notification.kind)) {
    return active && user.isDemo && matchesExpiry && now < notification.planEndsAt;
  }
  if (active) return false;
  return notification.requiresExpiryMatch ? matchesExpiry && now >= notification.planEndsAt : true;
}

export async function deliverPlanNotifications(
  now = new Date(),
  sender: (mail: SystemMail) => ReturnType<typeof sendSystemMail> = sendSystemMail,
) {
  const pending = await prisma.planNotification.findMany({
    where: { sentAt: null, canceledAt: null, nextAttemptAt: { lte: now } },
    include: { user: true },
    orderBy: { scheduledAt: "asc" },
    take: MAX_BATCH,
  });
  let sent = 0;
  let failed = 0;
  let canceled = 0;

  for (const notification of pending) {
    if (!isStillValid(notification, notification.user, now)) {
      await prisma.planNotification.updateMany({
        where: { id: notification.id, sentAt: null, canceledAt: null },
        data: { canceledAt: now },
      });
      canceled++;
      continue;
    }
    const recipients = await organizationAdminEmails(notification.user);
    if (recipients.length === 0) {
      await prisma.planNotification.update({
        where: { id: notification.id },
        data: { canceledAt: now, lastError: "organization has no administrators" },
      });
      canceled++;
      continue;
    }

    const claimed = await prisma.planNotification.updateMany({
      where: { id: notification.id, sentAt: null, canceledAt: null, nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + 10 * 60_000) },
    });
    if (claimed.count !== 1) continue;

    const result = await sender({ to: recipients, ...messageFor(notification, notification.user) });
    if (result.ok) {
      await prisma.planNotification.update({
        where: { id: notification.id },
        data: { sentAt: now, attempts: { increment: 1 }, lastError: null },
      });
      sent++;
    } else {
      const attempt = notification.attempts + 1;
      await prisma.planNotification.update({
        where: { id: notification.id },
        data: {
          attempts: attempt,
          lastError: result.error.slice(0, 1000),
          nextAttemptAt: new Date(now.getTime() + retryDelay(attempt)),
        },
      });
      failed++;
    }
  }
  return { checked: pending.length, sent, failed, canceled };
}
