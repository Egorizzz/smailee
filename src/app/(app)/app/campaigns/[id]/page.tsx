import Link from "next/link";
import { notFound } from "next/navigation";
import { can, campaignScope, requireWorkspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { launchCampaign, toggleCampaignArchive } from "../actions";
import { simulateReply, approveDraftReply } from "./actions";
import { EmailThread } from "@/components/EmailThread";
import { DraftReplyEditor } from "@/components/DraftReplyEditor";
import { PermissionDeniedButton } from "@/components/PermissionDeniedButton";
import { isPlanActive } from "@/lib/plans";
import { isWithinSendWindow } from "@/lib/schedule";
import { getEmailQuotaUsage } from "@/server/limits";
import { resolveCampaignQueueReason, type CampaignQueueReason } from "@/lib/campaignQueueReason";
import { CommunicationFunnel } from "@/components/CommunicationFunnel";
import { FunnelFilters } from "@/components/FunnelFilters";
import { isDemoWorkspaceActive, parseDemoCampaignStats } from "@/lib/demoWorkspace";

const queueReasonCopy: Record<CampaignQueueReason, { title: string; detail: string }> = {
  ACCESS_EXPIRED: {
    title: "Отправка приостановлена: срок доступа завершён",
    detail: "Очередь сохранена и продолжится автоматически после оплаты тарифа.",
  },
  PLAN_QUOTA_EXHAUSTED: {
    title: "Исчерпан месячный лимит писем по тарифу",
    detail: "Очередь сохранена. Отправка продолжится в новом месяце или после перехода на тариф выше.",
  },
  NO_AVAILABLE_MAILBOXES: {
    title: "Нет доступных ящиков для отправки",
    detail: "Проверьте подключение и прогрев ящиков в разделе «Инфраструктура». После восстановления кампания продолжится автоматически.",
  },
  MAILBOX_DAILY_LIMITS_EXHAUSTED: {
    title: "Дневные лимиты ящиков или доменов исчерпаны",
    detail: "Оставшиеся письма начнут отправляться в следующее рабочее окно после обновления дневных лимитов.",
  },
  OUTSIDE_SEND_WINDOW: {
    title: "Кампания ждёт окна отправки",
    detail: "Письма отправляются по будням с 09:00 до 19:00 по московскому времени. В ближайшее рабочее окно отправка начнётся автоматически.",
  },
  PROCESSING: {
    title: "Кампания готова к отправке",
    detail: "Очередь обрабатывается автоматически. Статус обновится после первой отправки.",
  },
};

function isSameCalendarDay(a: Date | null, b: Date): boolean {
  return Boolean(a && a.toDateString() === b.toDateString());
}

function lastValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.at(-1) : value;
}

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+03:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export default async function CampaignDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string | string[]; from?: string | string[]; to?: string | string[]; opens?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const error = lastValue(query.error);
  const workspace = await requireWorkspace();
  const user = workspace.owner;
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: user.id, isDemo: demoActive, ...campaignScope(workspace) },
    include: {
      messages: {
        include: { contact: true, thread: { orderBy: { createdAt: "asc" } }, lead: true },
        orderBy: { createdAt: "asc" },
        take: 50,
      },
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
    ...(from || to ? { sentAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [storedTotal, storedSent, storedDelivered, storedOpened, storedReplied, storedWarmLeads] = await Promise.all([
    prisma.message.count({ where: { campaignId: campaign.id } }),
    prisma.message.count({ where: { ...analyticsWhere, status: { in: ["SENT", "DELIVERED", "OPENED", "CLICKED", "REPLIED"] } } }),
    prisma.message.count({ where: { ...analyticsWhere, status: { in: ["DELIVERED", "OPENED", "CLICKED", "REPLIED"] } } }),
    prisma.message.count({ where: { ...analyticsWhere, openedAt: { not: null } } }),
    prisma.message.count({ where: { ...analyticsWhere, repliedAt: { not: null } } }),
    prisma.lead.count({ where: { qualification: "HOT", message: analyticsWhere } }),
  ]);
  const demoStats = campaign.isDemo ? parseDemoCampaignStats(campaign.demoStats) : null;
  const total = campaign.isDemo ? (campaign.demoAudienceSize ?? demoStats?.audience ?? storedTotal) : storedTotal;
  const sent = demoStats?.sent ?? storedSent;
  const delivered = demoStats?.delivered ?? storedDelivered;
  const opened = demoStats?.opened ?? storedOpened;
  const replied = demoStats?.replied ?? storedReplied;
  const warmLeads = demoStats?.warm ?? storedWarmLeads;

  const canLaunch = campaign.status === "DRAFT" || campaign.status === "PAUSED";
  const canManage = can(workspace, "CAMPAIGNS_MANAGE_ALL") || (can(workspace, "CAMPAIGNS_MANAGE_OWN") && campaign.createdById === workspace.actor.id);
  const canSeeRecipients = can(workspace, "CAMPAIGN_RECIPIENTS_VIEW");
  const canReply = can(workspace, "LEADS_REPLY_ALL") || (can(workspace, "LEADS_REPLY_OWN") && campaign.createdById === workspace.actor.id);

  // R4: прогретые ящики и ожидаемая дата готовности прогрева
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId: user.id, connState: { in: ["ok", "paused"] } },
    select: {
      warmupState: true,
      warmupStartedAt: true,
      coldSentToday: true,
      coldSentDate: true,
      coldDailyLimit: true,
      domainGroup: { select: { dailyLimit: true, sentToday: true, sentTodayDate: true } },
    },
  });
  const warmCount = campaign.isDemo ? 1 : mailboxes.filter((m) => m.warmupState === "warm").length;
  const warmingStarts = mailboxes
    .filter((m) => m.warmupState === "warming" && m.warmupStartedAt)
    .map((m) => m.warmupStartedAt!.getTime());
  const warmReadyDate =
    warmingStarts.length > 0
      ? new Date(Math.min(...warmingStarts) + config.warmup.rampDays * config.warmup.dayMs)
      : null;
  const waitingWarmup = campaign.status === "SCHEDULED" && campaign.launchAfterWarmup;
  const now = new Date();
  const availableMailboxes = mailboxes.filter((m) => m.warmupState === "warm");
  const mailboxesWithDailyCapacity = availableMailboxes.filter((m) => {
    const mailboxSent = isSameCalendarDay(m.coldSentDate, now) ? m.coldSentToday : 0;
    const domainSent = isSameCalendarDay(m.domainGroup.sentTodayDate, now) ? m.domainGroup.sentToday : 0;
    return mailboxSent < m.coldDailyLimit && domainSent < m.domainGroup.dailyLimit;
  });
  const [pendingMessages, emailUsage] = await Promise.all([
    prisma.message.count({ where: { campaignId: campaign.id, status: { in: ["PENDING", "QUEUED"] } } }),
    getEmailQuotaUsage(user, now),
  ]);
  const queueReason = campaign.isDemo ? null : resolveCampaignQueueReason({
    status: campaign.status,
    pendingMessages,
    planActive: isPlanActive(user.plan, user.planExpiresAt, now),
    planQuotaRemaining: emailUsage.remaining,
    availableMailboxes: availableMailboxes.length,
    mailboxesWithDailyCapacity: mailboxesWithDailyCapacity.length,
    withinSendWindow: isWithinSendWindow(now, config.sendWindow),
  });
  const queueNotice = queueReason ? queueReasonCopy[queueReason] : null;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/campaigns" className="text-sm text-ink-500 hover:text-slate-900">
        ← Все кампании
      </Link>
      {/* название кампании задаёт пользователь и может быть длинным, а кнопка
          «Запустить после прогрева» широкая — в одну строку на телефоне не
          помещаются. min-w-0 + break-words не дают длинному имени распирать блок */}
      <div className="mt-2 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold break-words text-slate-900">{campaign.name}</h1>
          <p className="mt-1 break-words text-ink-500">{campaign.subject}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">{canLaunch && total > 0 && (canManage ? (
          <form action={launchCampaign} className="shrink-0">
            <input type="hidden" name="id" value={campaign.id} />
            <button className="w-full rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
              {campaign.isDemo ? "▶ Запустить демо" : warmCount > 0 ? "▶ Запустить рассылку" : "▶ Запустить после прогрева"}
            </button>
          </form>
        ) : <PermissionDeniedButton label={warmCount > 0 ? "▶ Запустить рассылку" : "▶ Запустить после прогрева"} className="w-full rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white" />)}
        {canManage && <form action={toggleCampaignArchive}><input type="hidden" name="id" value={campaign.id} /><button className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink-700">{campaign.archivedAt ? "Вернуть из архива" : "В архив"}</button></form>}</div>
      </div>

      {waitingWarmup && (
        <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
          ⏳ Кампания стартует автоматически, как только ящики прогреются
          {warmReadyDate ? ` — примерно ${warmReadyDate.toLocaleDateString("ru-RU")}` : ""}.
          Прогресс прогрева — в разделе «Инфраструктура».
        </div>
      )}

      {queueNotice && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
          <div className="font-semibold">{queueNotice.title}</div>
          <p className="mt-1">{queueNotice.detail}</p>
          {queueReason === "PLAN_QUOTA_EXHAUSTED" && (
            <p className="mt-2 text-xs text-amber-700">
              Использовано {emailUsage.used} из {emailUsage.limit} писем в этом месяце.
            </p>
          )}
          {(queueReason === "ACCESS_EXPIRED" || queueReason === "PLAN_QUOTA_EXHAUSTED") && (
            can(workspace, "BILLING_MANAGE") ? (
              <Link href="/app/billing" className="mt-2 inline-block font-semibold underline underline-offset-2">
                Открыть тариф и оплату
              </Link>
            ) : (
              <p className="mt-2 font-medium">Обратитесь к администратору организации.</p>
            )
          )}
          {queueReason === "NO_AVAILABLE_MAILBOXES" && can(workspace, "INFRASTRUCTURE_MANAGE") && (
            <Link href="/app/mailboxes" className="mt-2 inline-block font-semibold underline underline-offset-2">
              Проверить ящики
            </Link>
          )}
        </div>
      )}

      {canLaunch && total > 0 && warmCount === 0 && !waitingWarmup && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Ящики ещё прогреваются{warmReadyDate ? ` (готовы ≈ ${warmReadyDate.toLocaleDateString("ru-RU")})` : ""}.
          Нажмите «Запустить после прогрева» — кампания стартует сама, ждать не нужно.
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
              <p className="text-sm font-semibold text-mint-950">Сформировано {campaign.demoGeneratedCount ?? campaign.messages.length} персонализированных примеров</p>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mint-900/75">
                Остальные {(Math.max(0, total - (campaign.demoGeneratedCount ?? campaign.messages.length))).toLocaleString("ru-RU")} писем показаны в расчёте воронки. Их тексты будут персонализированы только при запуске рабочей кампании.
              </p>
            </div>
            <span className="rounded-full border border-mint-200 bg-white px-3 py-1 text-xs font-semibold text-mint-800">Без реальной отправки</span>
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
          metrics={{ sent, delivered, opened, replied, warm: warmLeads }}
          showOpens={showOpens}
        />
      </div>

      {total === 0 && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          В кампании нет писем — вероятно, в выбранном сегменте нет контактов.
          Загрузите базу и создайте кампанию заново.
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-slate-900">{campaign.isDemo ? "Примеры писем" : "Письма"}</h2>
      <div className="mt-3 space-y-3">
        {campaign.messages.map((m) => (
          <div key={m.id} className="rounded-xl border border-line bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-medium text-slate-900">
                  {canSeeRecipients ? (m.contact.name ?? m.contact.email) : "Получатель скрыт"}
                </span>
                {canSeeRecipients && m.contact.company && (
                  <span className="text-ink-500"> · {m.contact.company}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {m.lead && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      m.lead.qualification === "HOT"
                        ? "bg-mint-100 text-mint-700"
                        : "bg-surface text-ink-500"
                    }`}
                  >
                    {m.lead.qualification === "HOT" ? "Тёплый лид" : m.lead.qualification}
                  </span>
                )}
                <span className="rounded-md bg-surface px-2 py-0.5 text-xs text-ink-700">
                  {m.status}
                </span>
              </div>
            </div>

            {!canSeeRecipients && <p className="mt-3 text-sm text-ink-500">Данные получателя скрыты.</p>}

            {/* email-тред */}
            {canSeeRecipients && m.thread.length > 0 && <EmailThread thread={m.thread} />}

            {/* модерация: черновик AI-ответа ждёт одобрения оператора (§5.5) */}
            {canReply && canSeeRecipients ? m.thread
              .filter((t) => t.direction === "outbound" && t.status === "DRAFT" && t.kind === "REPLY")
              .map((draft) => (
                <DraftReplyEditor
                  key={draft.id}
                  replyId={draft.id}
                  initialBody={draft.body}
                  action={approveDraftReply}
                />
              )) : m.thread.some((t) => t.direction === "outbound" && t.status === "DRAFT" && t.kind === "REPLY") ? <div className="mt-3"><PermissionDeniedButton label="Одобрить и отправить ответ" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700" /></div> : null}

            {/* симуляция ответа — только для отправленных без ответа */}
            {["SENT", "DELIVERED", "OPENED"].includes(m.status) && (canManage ? (
              <form action={simulateReply} className="mt-3 flex gap-2">
                <input type="hidden" name="messageId" value={m.id} />
                <input
                  name="text"
                  placeholder="Симулировать ответ клиента…"
                  className="input flex-1 !py-1.5 text-xs"
                />
                <button className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                  Ответить как клиент
                </button>
              </form>
            ) : <div className="mt-3"><PermissionDeniedButton label="Ответить как клиент" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700" /></div>)}
          </div>
        ))}
      </div>
    </div>
  );
}
