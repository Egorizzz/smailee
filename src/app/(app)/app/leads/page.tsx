import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { can, requireWorkspace, workspaceHome } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { reopenSetup } from "../setup/actions";
import { CommunicationFunnel } from "@/components/CommunicationFunnel";
import { FunnelFilters } from "@/components/FunnelFilters";
import { getPublishedBusinessProfile, isBusinessProfileReady } from "@/lib/businessProfile/context";
import { autoPingLifecycleState, isConversationFrozen } from "@/lib/inboxState";

type AnalyticsSearchParams = {
  setupRequested?: string | string[];
  from?: string | string[];
  to?: string | string[];
  campaign?: string | string[];
  segment?: string | string[];
  opens?: string | string[];
};

function lastValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.at(-1) : value;
}

function values(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+03:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<AnalyticsSearchParams> }) {
  const workspace = await requireWorkspace();
  const user = workspace.owner;
  const canSeeAll = can(workspace, "STATS_VIEW_ALL") || can(workspace, "LEADS_VIEW_ALL") || can(workspace, "LEADS_REPLY_ALL");
  const canSeeOwn = can(workspace, "LEADS_REPLY_OWN");
  if (!canSeeAll && !canSeeOwn) redirect(workspaceHome(workspace));
  const campaignWhere = { userId: user.id, ...(canSeeAll ? {} : { createdById: workspace.actor.id }) };
  const query = await searchParams;
  const setupRequested = lastValue(query.setupRequested);

  const [mbCount, ctCount, cpCount, campaignOptions, segmentRows, businessProfile, inboxRows] = await Promise.all([
    prisma.mailbox.count({ where: { userId: user.id } }),
    prisma.contact.count({ where: { userId: user.id } }),
    prisma.campaign.count({ where: campaignWhere }),
    prisma.campaign.findMany({ where: campaignWhere, select: { id: true, name: true, trackingEnabled: true }, orderBy: { createdAt: "desc" } }),
    prisma.contact.findMany({ where: { userId: user.id }, select: { segment: true }, distinct: ["segment"], orderBy: { segment: "asc" } }),
    getPublishedBusinessProfile(user),
    prisma.message.findMany({
      where: { campaign: campaignWhere, thread: { some: { direction: "inbound" } } },
      select: {
        campaignId: true,
        contactId: true,
        refusedAt: true,
        nextContactAt: true,
        aiRepliesEnabled: true,
        autoPingEnabled: true,
        autoPingAttempts: true,
        autoPingMaxAttempts: true,
        autoPingStoppedAt: true,
        thread: { select: { direction: true, status: true, createdAt: true } },
        lead: { select: { qualification: true, processedAt: true, handedOffAt: true } },
      },
    }),
  ]);
  const setupIncomplete = !businessProfile.published || !isBusinessProfileReady(businessProfile.profile) || mbCount === 0 || ctCount === 0 || cpCount === 0;

  const allowedCampaignIds = new Set(campaignOptions.map((campaign) => campaign.id));
  const selectedCampaigns = values(query.campaign).filter((id) => allowedCampaignIds.has(id));
  const selectedSegments = values(query.segment);
  const dateFrom = lastValue(query.from);
  const dateTo = lastValue(query.to);
  const from = parseDate(dateFrom);
  const to = parseDate(dateTo, true);
  const campaignsInView = selectedCampaigns.length > 0 ? campaignOptions.filter((campaign) => selectedCampaigns.includes(campaign.id)) : campaignOptions;
  const canShowOpens = campaignsInView.length > 0 && campaignsInView.every((campaign) => campaign.trackingEnabled);
  const showOpens = canShowOpens && lastValue(query.opens) !== "0";
  const segmentNames = selectedSegments.filter((segment) => segment !== "__none__");

  const messageWhere: Prisma.MessageWhereInput = {
    campaign: campaignWhere,
    ...(selectedCampaigns.length > 0 ? { campaignId: { in: selectedCampaigns } } : {}),
    ...(from || to ? { sentAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(selectedSegments.length > 0 ? { OR: [
      ...(segmentNames.length > 0 ? [{ contact: { segment: { in: segmentNames } } }] : []),
      ...(selectedSegments.includes("__none__") ? [{ contact: { segment: null } }] : []),
    ] } : {}),
  };

  const [sent, delivered, opened, replied, hotLeads, supByReason] = await Promise.all([
    prisma.message.count({ where: { ...messageWhere, status: { in: ["SENT", "DELIVERED", "OPENED", "CLICKED", "REPLIED"] } } }),
    prisma.message.count({ where: { ...messageWhere, status: { in: ["DELIVERED", "OPENED", "CLICKED", "REPLIED"] } } }),
    prisma.message.count({ where: { ...messageWhere, openedAt: { not: null } } }),
    prisma.message.count({ where: { ...messageWhere, repliedAt: { not: null } } }),
    prisma.lead.count({ where: { userId: user.id, qualification: "HOT", message: messageWhere } }),
    prisma.suppression.groupBy({ by: ["reason"], where: { userId: user.id, releasedAt: null }, _count: true }),
  ]);
  const supCount = (reason: string) => supByReason.find((item) => item.reason === reason)?._count ?? 0;
  const segmentOptions = segmentRows.map(({ segment }) => ({ value: segment ?? "__none__", label: segment ?? "Без сегмента" }));
  const now = new Date();
  const frozenGroups = new Map<string, typeof inboxRows>();
  for (const message of inboxRows) {
    if (!isConversationFrozen(message, now, user.autoPingStartAfterDays)) continue;
    const key = `${message.campaignId}:${message.contactId}`;
    frozenGroups.set(key, [...(frozenGroups.get(key) ?? []), message]);
  }
  const frozenNeedingAttention = [...frozenGroups.values()].filter((group) => !group.some((message) => autoPingLifecycleState(message, {
    enabled: user.autoPingEnabled,
    maxAttempts: user.autoPingMaxAttempts,
  }) === "active"));
  const frozenNeedsAttentionCount = frozenNeedingAttention.length;
  const exhaustedAutoPingCount = frozenNeedingAttention.filter((group) => group.some((message) => autoPingLifecycleState(message, {
    enabled: user.autoPingEnabled,
    maxAttempts: user.autoPingMaxAttempts,
  }) === "exhausted")).length;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Главная</h1>
          <p className="mt-1 text-ink-500">Результаты коммуникаций и переходы между этапами.</p>
        </div>
        <Link href="/app/inbox" className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:border-slate-400">Открыть Inbox →</Link>
      </div>

      {setupRequested && <div className="mt-4 rounded-lg border border-mint-400 bg-mint-100/40 px-4 py-3 text-sm text-mint-700">Заявка отправлена — специалист свяжется с вами для онлайн-настройки.</div>}
      {setupIncomplete && !setupRequested && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <span className="text-sm text-indigo-700">Настройка не завершена — данные появятся после запуска первой кампании.</span>
          <form action={reopenSetup}><button className="brand-gradient rounded-lg px-4 py-2 text-xs font-semibold text-white">Продолжить настройку →</button></form>
        </div>
      )}

      {frozenNeedsAttentionCount > 3 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-sky-950"><span className="metric-number text-lg">{frozenNeedsAttentionCount}</span> остывших клиентов без активного автопинга</p>
            <p className="mt-1 text-xs text-sky-800/80">Они молчат больше <span className="metric-number">{user.autoPingStartAfterDays}</span> дней. Настройте автопинг или завершите коммуникацию.</p>
            {exhaustedAutoPingCount > 0 && <p className="mt-1 text-xs font-medium text-sky-900"><span className="metric-number">{exhaustedAutoPingCount}</span> из них уже получили все запланированные попытки.</p>}
          </div>
          <Link href="/app/inbox?state=frozen&autoping=attention" className="rounded-full bg-sky-900 px-4 py-2 text-xs font-semibold text-white">Разобрать →</Link>
        </div>
      )}

      <div className="mt-6 space-y-3">
        <FunnelFilters
          actionPath="/app/analytics"
          resetHref="/app/analytics"
          campaigns={campaignOptions.map((campaign) => ({ value: campaign.id, label: campaign.name }))}
          segments={segmentOptions}
          selectedCampaigns={selectedCampaigns}
          selectedSegments={selectedSegments}
          dateFrom={dateFrom}
          dateTo={dateTo}
          showOpens={showOpens}
          canShowOpens={canShowOpens}
        />
        <CommunicationFunnel metrics={{ sent, delivered, opened, replied, warm: hotLeads }} showOpens={showOpens} />
        <div className="rounded-xl border border-line bg-white px-5 py-2.5 text-xs text-ink-500">
          Отписки <span className="metric-number">{supCount("unsubscribed") + supCount("declined_via_reply")}</span> · жалобы <span className="metric-number">{supCount("complained")}</span> · недоставлено <span className="metric-number">{supCount("bounced")}</span> · <Link href="/app/contacts?tab=suppressions" className="font-medium underline hover:text-slate-900">открыть стоп-лист</Link>
        </div>
      </div>
    </div>
  );
}
