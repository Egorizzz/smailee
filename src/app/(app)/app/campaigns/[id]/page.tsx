import { deliveryIssueCounts } from "@/server/campaigns/deliveryMetrics";
import { deliveryIssueLabel } from "@/lib/mail/deliverySignals";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can, campaignScope, requireWorkspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { launchCampaign, toggleCampaignArchive } from "../actions";
import { PermissionDeniedButton } from "@/components/PermissionDeniedButton";
import { isPlanActive } from "@/lib/plans";
import { isWithinSendWindow } from "@/lib/schedule";
import { getEmailQuotaUsage } from "@/server/limits";
import {
  resolveCampaignQueueReason,
  type CampaignQueueReason,
} from "@/lib/campaignQueueReason";
import { CommunicationFunnel } from "@/components/CommunicationFunnel";
import { FunnelFilters } from "@/components/FunnelFilters";
import {
  isDemoWorkspaceActive,
  parseDemoCampaignStats,
} from "@/lib/demoWorkspace";

const queueReasonCopy: Record<
  CampaignQueueReason,
  { title: string; detail: string }
> = {
  ACCESS_EXPIRED: {
    title: "Отправка приостановлена: срок доступа завершён",
    detail:
      "Очередь сохранена и продолжится автоматически после оплаты тарифа.",
  },
  PLAN_QUOTA_EXHAUSTED: {
    title: "Исчерпан месячный лимит писем по тарифу",
    detail:
      "Очередь сохранена. Отправка продолжится в новом месяце или после перехода на тариф выше.",
  },
  NO_AVAILABLE_MAILBOXES: {
    title: "Нет доступных ящиков для отправки",
    detail:
      "Проверьте подключение и прогрев ящиков в разделе «Инфраструктура». После восстановления кампания продолжится автоматически.",
  },
  MAILBOX_DAILY_LIMITS_EXHAUSTED: {
    title: "Дневные лимиты ящиков или доменов исчерпаны",
    detail:
      "Оставшиеся письма начнут отправляться в следующее рабочее окно после обновления дневных лимитов.",
  },
  OUTSIDE_SEND_WINDOW: {
    title: "Кампания ждёт окна отправки",
    detail:
      "Письма отправляются по будням с 09:00 до 19:00 по московскому времени. В ближайшее рабочее окно отправка начнётся автоматически.",
  },
  PROCESSING: {
    title: "Кампания выполняется по расписанию",
    detail:
      "Плановые даты и ящики указаны ниже. Расписание обновится, если доступность ящиков изменится.",
  },
};

function isSameCalendarDay(a: Date | null, b: Date): boolean {
  return Boolean(a && a.toDateString() === b.toDateString());
}

function lastValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.at(-1) : value;
}

function parseDate(
  value: string | undefined,
  endOfDay = false,
): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+03:00`,
  );
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export default async function CampaignDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string | string[];
    from?: string | string[];
    to?: string | string[];
    opens?: string | string[];
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const error = lastValue(query.error);
  const workspace = await requireWorkspace();
  const user = workspace.owner;
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);

  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
      userId: user.id,
      isDemo: demoActive,
      ...campaignScope(workspace),
    },
  });
  if (!campaign) notFound();

  const dateFrom = lastValue(query.from);
  const dateTo = lastValue(query.to);
  const from = parseDate(dateFrom);
  const to = parseDate(dateTo, true);
  const showOpens = campaign.trackingEnabled && lastValue(query.opens) !== "0";
  const analyticsWhere = {
    campaignId: campaign.id,
    ...(from || to
      ? {
          sentAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };
  const [
    storedTotal,
    storedSent,
    storedOpened,
    storedReplied,
    storedWarmLeads,
  ] = await Promise.all([
    prisma.message.count({
      where: { campaignId: campaign.id, status: { not: "CANCELLED" } },
    }),
    prisma.message.count({
      where: {
        ...analyticsWhere,
        sentAt: {
          not: null,
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      },
    }),
    prisma.message.count({
      where: { ...analyticsWhere, openedAt: { not: null } },
    }),
    prisma.message.count({
      where: { ...analyticsWhere, repliedAt: { not: null } },
    }),
    prisma.lead.count({
      where: { qualification: "HOT", message: analyticsWhere },
    }),
  ]);
  const demoStats = campaign.isDemo
    ? parseDemoCampaignStats(campaign.demoStats)
    : null;
  const total = campaign.isDemo
    ? (campaign.demoAudienceSize ?? demoStats?.audience ?? storedTotal)
    : storedTotal;
  const sent = demoStats?.sent ?? storedSent;
  const opened = demoStats?.opened ?? storedOpened;
  const replied = demoStats?.replied ?? storedReplied;
  const warmLeads = demoStats?.warm ?? storedWarmLeads;

  const [issues, plannedMessages, excludedBoxes] = await Promise.all([
    campaign.isDemo ? Promise.resolve([]) : deliveryIssueCounts(analyticsWhere),
    prisma.message.findMany({
      where: { campaignId: campaign.id },
      orderBy: [{ plannedSendAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        subject: true,
        status: true,
        sentAt: true,
        plannedSendAt: true,
        plannedMailboxId: true,
        deliveryIssue: true,
        contact: { select: { id: true, email: true } },
        mailbox: { select: { email: true } },
      },
    }),
    prisma.campaignMailboxState.findMany({
      where: {
        campaignId: campaign.id,
        excludedAt: { not: null },
        resumedAt: null,
      },
      include: { mailbox: { select: { email: true } } },
    }),
  ]);
  const plannedBoxIds = [
    ...new Set(
      plannedMessages.flatMap((m) =>
        m.plannedMailboxId ? [m.plannedMailboxId] : [],
      ),
    ),
  ];
  const plannedBoxes = await prisma.mailbox.findMany({
    where: { id: { in: plannedBoxIds }, userId: user.id },
    select: { id: true, email: true },
  });
  const formatTime = (date: Date) =>
    date.toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const canLaunch = campaign.status === "DRAFT" || campaign.status === "PAUSED";
  const canManage =
    can(workspace, "CAMPAIGNS_MANAGE_ALL") ||
    (can(workspace, "CAMPAIGNS_MANAGE_OWN") &&
      campaign.createdById === workspace.actor.id);

  // R4: прогретые ящики и ожидаемая дата готовности прогрева
  const mailboxes = await prisma.mailbox.findMany({
    where: {
      userId: user.id,
      connState: { in: ["ok", "paused"] },
      id: { notIn: excludedBoxes.map((item) => item.mailboxId) },
      OR: [
        { smtpBlockedUntil: null },
        { smtpBlockedUntil: { lte: new Date() } },
      ],
    },
    select: {
      warmupState: true,
      warmupStartedAt: true,
      coldSentToday: true,
      coldSentDate: true,
      coldDailyLimit: true,
      domainGroup: {
        select: { dailyLimit: true, sentToday: true, sentTodayDate: true },
      },
    },
  });
  const warmCount = campaign.isDemo
    ? 1
    : mailboxes.filter((m) => m.warmupState === "warm").length;
  const warmingStarts = mailboxes
    .filter((m) => m.warmupState === "warming" && m.warmupStartedAt)
    .map((m) => m.warmupStartedAt!.getTime());
  const warmReadyDate =
    warmingStarts.length > 0
      ? new Date(
          Math.min(...warmingStarts) +
            config.warmup.rampDays * config.warmup.dayMs,
        )
      : null;
  const waitingWarmup =
    campaign.status === "SCHEDULED" && campaign.launchAfterWarmup;
  const now = new Date();
  const availableMailboxes = mailboxes.filter((m) => m.warmupState === "warm");
  const mailboxesWithDailyCapacity = availableMailboxes.filter((m) => {
    const mailboxSent = isSameCalendarDay(m.coldSentDate, now)
      ? m.coldSentToday
      : 0;
    const domainSent = isSameCalendarDay(m.domainGroup.sentTodayDate, now)
      ? m.domainGroup.sentToday
      : 0;
    return (
      mailboxSent < m.coldDailyLimit && domainSent < m.domainGroup.dailyLimit
    );
  });
  const [pendingMessages, emailUsage] = await Promise.all([
    prisma.message.count({
      where: {
        campaignId: campaign.id,
        status: { in: ["PENDING", "QUEUED", "SENDING"] },
      },
    }),
    getEmailQuotaUsage(user, now),
  ]);
  const queueReason = campaign.isDemo
    ? null
    : resolveCampaignQueueReason({
        status: campaign.status,
        pendingMessages,
        planActive: isPlanActive(user.plan, user.planExpiresAt, now),
        planQuotaRemaining: emailUsage.remaining,
        availableMailboxes: availableMailboxes.length,
        mailboxesWithDailyCapacity: mailboxesWithDailyCapacity.length,
        withinSendWindow:
          campaign.sendAnytime || isWithinSendWindow(now, config.sendWindow),
      });
  const queueNotice = queueReason ? queueReasonCopy[queueReason] : null;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/app/campaigns"
        className="text-sm text-ink-500 hover:text-slate-900"
      >
        ← Все кампании
      </Link>
      {/* название кампании задаёт пользователь и может быть длинным, а кнопка
          «Запустить после прогрева» широкая — в одну строку на телефоне не
          помещаются. min-w-0 + break-words не дают длинному имени распирать блок */}
      <div className="mt-2 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold break-words text-slate-900">
            {campaign.name}
          </h1>
          <p className="mt-1 break-words text-ink-500">{campaign.subject}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canLaunch &&
            total > 0 &&
            (canManage ? (
              <form action={launchCampaign} className="shrink-0">
                <input type="hidden" name="id" value={campaign.id} />
                <button className="w-full rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
                  {campaign.isDemo
                    ? "▶ Запустить демо"
                    : warmCount > 0
                      ? "▶ Запустить рассылку"
                      : "▶ Запустить после прогрева"}
                </button>
              </form>
            ) : (
              <PermissionDeniedButton
                label={
                  warmCount > 0
                    ? "▶ Запустить рассылку"
                    : "▶ Запустить после прогрева"
                }
                className="w-full rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white"
              />
            ))}
          {canManage && (
            <form action={toggleCampaignArchive}>
              <input type="hidden" name="id" value={campaign.id} />
              <button className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink-700">
                {campaign.archivedAt ? "Вернуть из архива" : "В архив"}
              </button>
            </form>
          )}
        </div>
      </div>

      {!campaign.isDemo && (
        <p className="mt-4 text-sm text-ink-500">
          Планируемое завершение отправки:{" "}
          <span className="metric-number font-semibold text-slate-900">
            {campaign.plannedCompletionAt
              ? `${formatTime(campaign.plannedCompletionAt)} МСК`
              : campaign.status === "SENT"
                ? "Отправка завершена"
                : "Срок появится после распределения писем"}
          </span>
        </p>
      )}
      {excludedBoxes.map((item) => (
        <div
          key={item.id}
          role="status"
          className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          Ящик {item.mailbox.email} временно отключён от кампании после отказов
          антиспама и направлен на повторный прогрев после паузы отправки. Ещё
          не отправленные письма перераспределяются между доступными ящиками.
        </div>
      ))}
      {waitingWarmup && (
        <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
          ⏳ Кампания стартует автоматически, как только ящики прогреются
          {warmReadyDate
            ? ` — примерно ${warmReadyDate.toLocaleDateString("ru-RU")}`
            : ""}
          . Прогресс прогрева — в разделе «Инфраструктура».
        </div>
      )}

      {queueNotice && (
        <div
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          role="status"
        >
          <div className="font-semibold">{queueNotice.title}</div>
          <p className="mt-1">{queueNotice.detail}</p>
          {queueReason === "PLAN_QUOTA_EXHAUSTED" && (
            <p className="mt-2 text-xs text-amber-700">
              Использовано {emailUsage.used} из {emailUsage.limit} писем в этом
              месяце.
            </p>
          )}
          {(queueReason === "ACCESS_EXPIRED" ||
            queueReason === "PLAN_QUOTA_EXHAUSTED") &&
            (can(workspace, "BILLING_MANAGE") ? (
              <Link
                href="/app/billing"
                className="mt-2 inline-block font-semibold underline underline-offset-2"
              >
                Открыть тариф и оплату
              </Link>
            ) : (
              <p className="mt-2 font-medium">
                Обратитесь к администратору организации.
              </p>
            ))}
          {queueReason === "NO_AVAILABLE_MAILBOXES" &&
            can(workspace, "INFRASTRUCTURE_MANAGE") && (
              <Link
                href="/app/mailboxes"
                className="mt-2 inline-block font-semibold underline underline-offset-2"
              >
                Проверить ящики
              </Link>
            )}
        </div>
      )}

      {canLaunch && total > 0 && warmCount === 0 && !waitingWarmup && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Ящики ещё прогреваются
          {warmReadyDate
            ? ` (готовы ≈ ${warmReadyDate.toLocaleDateString("ru-RU")})`
            : ""}
          . Нажмите «Запустить после прогрева» — кампания стартует сама, ждать
          не нужно.
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {campaign.isDemo && (
        <div className="mt-4 rounded-2xl border border-mint-200 bg-[#eff8f2] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-mint-950">
                Сформировано {campaign.demoGeneratedCount ?? storedTotal}{" "}
                персонализированных примеров
              </p>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mint-900/75">
                Остальные{" "}
                {Math.max(
                  0,
                  total - (campaign.demoGeneratedCount ?? storedTotal),
                ).toLocaleString("ru-RU")}{" "}
                писем показаны в расчёте воронки. Их тексты будут
                персонализированы только при запуске рабочей кампании.
              </p>
            </div>
            <span className="rounded-full border border-mint-200 bg-white px-3 py-1 text-xs font-semibold text-mint-800">
              Без реальной отправки
            </span>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        <FunnelFilters
          actionPath={`/app/campaigns/${campaign.id}`}
          resetHref={`/app/campaigns/${campaign.id}`}
          dateFrom={dateFrom}
          dateTo={dateTo}
          showOpens={showOpens}
          canShowOpens={campaign.trackingEnabled}
        />
        <CommunicationFunnel
          compact
          title="Результаты кампании"
          metrics={{ sent, opened, replied, warm: warmLeads }}
          showOpens={showOpens}
          issues={issues}
        />
      </div>

      {total === 0 && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          В кампании нет писем — вероятно, в выбранном сегменте нет контактов.
          Загрузите базу и создайте кампанию заново.
        </div>
      )}

      {!campaign.isDemo && plannedMessages.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
          <h2 className="px-5 py-4 text-sm font-semibold">
            Расписание писем{" "}
            <span className="text-xs font-normal text-ink-500">
              · время МСК
            </span>
          </h2>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-ink-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Получатель</th>
                  <th className="px-4 py-3 font-medium">План отправки</th>
                  <th className="px-4 py-3 font-medium">Ящик</th>
                  <th className="px-4 py-3 font-medium">Результат</th>
                </tr>
              </thead>
              <tbody>
                {plannedMessages.map((message) => (
                  <tr key={message.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/contacts?contact=${encodeURIComponent(message.contact.id)}`}
                        className="underline underline-offset-2"
                      >
                        {message.contact.email}
                      </Link>
                      <p className="mt-1 text-ink-500">{message.subject}</p>
                    </td>
                    <td className="metric-number whitespace-nowrap px-4 py-3">
                      {message.plannedSendAt
                        ? formatTime(message.plannedSendAt)
                        : "Ожидает распределения"}
                    </td>
                    <td className="px-4 py-3">
                      {message.mailbox?.email ??
                        plannedBoxes.find(
                          (b) => b.id === message.plannedMailboxId,
                        )?.email ??
                        "Не назначен"}
                    </td>
                    <td className="px-4 py-3">
                      {message.deliveryIssue ? (
                        <span className="text-amber-800">
                          {deliveryIssueLabel(message.deliveryIssue)} · DEL-1401
                        </span>
                      ) : message.sentAt ? (
                        "Отправлено"
                      ) : message.status === "CANCELLED" ? (
                        "Отменено"
                      ) : message.status === "SENDING" ? (
                        "Проверяем результат"
                      ) : message.status === "FAILED" ? (
                        "Не отправлено · DEL-1402"
                      ) : (
                        "Запланировано"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="mt-8 flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Письма и ответы по кампании
          </h2>
          <p className="mt-1 text-xs leading-5 text-ink-500">
            Откройте Inbox — фильтр этой кампании уже будет выбран.
          </p>
        </div>
        <Link
          href={`/app/inbox?campaign=${encodeURIComponent(campaign.id)}`}
          className="shrink-0 rounded-lg border border-line bg-white px-4 py-2.5 text-center text-sm font-semibold text-slate-900 transition hover:border-mint-300 hover:bg-mint-50"
        >
          Открыть в Inbox →
        </Link>
      </div>
    </div>
  );
}
