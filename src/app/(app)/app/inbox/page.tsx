import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireWorkspace, workspaceHome } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { autoPingLifecycleState, hasInboundReply, isConversationFrozen, isConversationUnanswered } from "@/lib/inboxState";
import { InboxFilters } from "@/components/InboxFilters";
import { InboxReplyComposer } from "@/components/InboxReplyComposer";
import { EmailThread, type InboxTimelineItem } from "@/components/EmailThread";
import { DraftReplyEditor } from "@/components/DraftReplyEditor";
import { ConversationAutoPing } from "@/components/ConversationAutoPing";
import { ScheduledAutoPingDraft } from "@/components/ScheduledAutoPingDraft";
import { PushToCrmButton } from "@/components/PushToCrmButton";
import { ProcessedLeadButton, TelegramLeadButton } from "@/components/LeadQuickActions";
import { PermissionDeniedButton } from "@/components/PermissionDeniedButton";
import { approveDraftReply } from "../campaigns/[id]/actions";
import { confirmConversationRefusal, dismissConversationRefusal, toggleConversationAi } from "./actions";
import { triggerLabel } from "@/lib/crm/handoffTriggers";

type InboxSearchParams = {
  q?: string | string[];
  state?: string | string[];
  scope?: string | string[];
  campaign?: string | string[];
  mailbox?: string | string[];
  thread?: string | string[];
  autoping?: string | string[];
};

const value = (input: string | string[] | undefined) => Array.isArray(input) ? input.at(-1) : input;
const qualification = {
  HOT: { label: "Тёплый", className: "bg-mint-100 text-mint-800" },
  COLD: { label: "Холодный", className: "bg-slate-100 text-slate-600" },
  IRRELEVANT: { label: "Нецелевой", className: "bg-slate-100 text-slate-600" },
  UNKNOWN: { label: "Не определён", className: "bg-slate-100 text-slate-600" },
} as const;

function latestDate(dates: Array<Date | null | undefined>, fallback: Date) {
  return dates.reduce<Date>((latest, date) => date && date > latest ? date : latest, fallback);
}

function formatListDate(date: Date) {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  const workspace = await requireWorkspace();
  const canSeeAll = can(workspace, "LEADS_VIEW_ALL") || can(workspace, "LEADS_REPLY_ALL");
  const canSeeOwn = can(workspace, "LEADS_REPLY_OWN");
  const canReply = can(workspace, "LEADS_REPLY_ALL") || canSeeOwn;
  if (!canSeeAll && !canSeeOwn) redirect(workspaceHome(workspace));

  const query = await searchParams;
  const q = value(query.q)?.trim().toLocaleLowerCase("ru-RU") ?? "";
  const requestedState = value(query.state) ?? "active";
  // Старые сохранённые ссылки на отдельную папку черновиков ведём в общую
  // папку действий: черновик — частный случай диалога, которому нужен ответ.
  const state = requestedState === "draft" ? "unanswered" : requestedState;
  const scope = value(query.scope) ?? "all";
  const selectedCampaign = value(query.campaign);
  const selectedMailbox = value(query.mailbox);
  const selectedThread = value(query.thread);
  const autoPingFilter = value(query.autoping);
  const campaignWhere = { userId: workspace.owner.id, ...(canSeeAll ? {} : { createdById: workspace.actor.id }) };

  const [messages, campaignOptions, mailboxOptions] = await Promise.all([
    prisma.message.findMany({
      where: {
        campaign: campaignWhere,
        status: { in: ["PENDING", "QUEUED", "SENT", "DELIVERED", "OPENED", "CLICKED", "REPLIED"] },
      },
      include: {
        contact: true,
        campaign: { select: { id: true, name: true, followupSteps: { orderBy: { stepNumber: "asc" } } } },
        mailbox: { select: { id: true, email: true } },
        thread: { orderBy: { createdAt: "asc" } },
        lead: true,
      },
    }),
    prisma.campaign.findMany({ where: campaignWhere, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
    prisma.mailbox.findMany({ where: { userId: workspace.owner.id }, select: { id: true, email: true }, orderBy: { email: "asc" } }),
  ]);

  type RawMessage = (typeof messages)[number];
  const groups = new Map<string, RawMessage[]>();
  for (const message of messages) {
    const key = `${message.campaignId}:${message.contactId}`;
    groups.set(key, [...(groups.get(key) ?? []), message]);
  }

  const conversations = [...groups.entries()].map(([key, group]) => {
    const lastEventFor = (message: RawMessage) => latestDate(
      [message.sentAt, message.deliveredAt, message.openedAt, message.clickedAt, message.repliedAt, ...message.thread.map((item) => item.createdAt)],
      message.createdAt,
    );
    const withInbound = group.filter((message) => hasInboundReply(message.thread));
    const anchorPool = withInbound.length ? withInbound : group;
    const anchor = [...anchorPool].sort((a, b) => lastEventFor(b).getTime() - lastEventFor(a).getTime())[0];
    const lead = anchor.lead ?? [...group].sort((a, b) => lastEventFor(b).getTime() - lastEventFor(a).getTime()).find((item) => item.lead)?.lead ?? null;
    const replyThread = group.flatMap((message) => message.thread).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const timeline: InboxTimelineItem[] = [
      ...group.filter((message) => message.sentAt).map((message) => ({
        id: `campaign-${message.id}`,
        direction: "outbound",
        subject: message.subject,
        fromEmail: message.mailbox?.email ?? null,
        toEmail: message.contact.email,
        body: message.body,
        isAi: false,
        status: "SENT",
        createdAt: message.sentAt!,
      })),
      ...replyThread.filter((item) => item.status !== "DRAFT"),
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const lastEventAt = timeline.length ? new Date(timeline.at(-1)!.createdAt) : latestDate(group.map((message) => message.createdAt), anchor.createdAt);
    const refusedAt = group.map((message) => message.refusedAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
    const refusalSuggestedAt = group.map((message) => message.refusalSuggestedAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
    const nextContactAt = group.map((message) => message.nextContactAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
    const frozen = isConversationFrozen(
      { thread: replyThread, lead, refusedAt, nextContactAt },
      new Date(),
      workspace.owner.autoPingStartAfterDays,
    );
    const unanswered = isConversationUnanswered(replyThread);
    const drafts = replyThread.filter((item) => item.direction === "outbound" && item.status === "DRAFT" && item.kind === "REPLY");
    const autoPingDraft = [...replyThread].reverse().find((item) => item.direction === "outbound" && item.status === "DRAFT" && item.kind === "AUTO_PING") ?? null;
    const autoPingState = autoPingLifecycleState(anchor, {
      enabled: workspace.owner.autoPingEnabled,
      maxAttempts: workspace.owner.autoPingMaxAttempts,
    });
    return { key, group, anchor, lead, replyThread, timeline, lastEventAt, refusedAt, refusalSuggestedAt, nextContactAt, frozen, unanswered, drafts, autoPingDraft, autoPingState, hasInbound: hasInboundReply(replyThread) };
  }).sort((a, b) => b.lastEventAt.getTime() - a.lastEventAt.getTime());

  const visible = conversations.filter((conversation) => {
    const { anchor, lead } = conversation;
    if (selectedCampaign && anchor.campaignId !== selectedCampaign) return false;
    if (selectedMailbox && !conversation.group.some((message) => message.mailboxId === selectedMailbox)) return false;
    if (scope === "replied" && !conversation.hasInbound) return false;
    if (q && ![
      anchor.contact.name,
      anchor.contact.email,
      anchor.contact.company,
      anchor.subject,
      anchor.campaign.name,
      conversation.timeline.at(-1)?.body,
    ].some((item) => item?.toLocaleLowerCase("ru-RU").includes(q))) return false;
    if (state === "active" && (lead?.processedAt || conversation.refusedAt)) return false;
    if (state === "unanswered" && (!conversation.unanswered || lead?.processedAt || conversation.refusedAt)) return false;
    if (state === "warm" && (lead?.qualification !== "HOT" || !conversation.unanswered || lead.processedAt || conversation.refusedAt)) return false;
    if (state === "frozen" && !conversation.frozen) return false;
    if (autoPingFilter === "attention" && conversation.autoPingState === "active") return false;
    if (state === "refused" && !conversation.refusedAt) return false;
    if (state === "processed" && !lead?.processedAt) return false;
    return true;
  });

  const active = visible.find((item) => item.group.some((message) => message.id === selectedThread))
    ?? conversations.find((item) => item.group.some((message) => message.id === selectedThread));
  const hasBitrix = Boolean(workspace.owner.bitrixWebhookEnc);
  const hasTelegram = Boolean(workspace.owner.telegramChatId);
  const currentParams = new URLSearchParams();
  if (state !== "active") currentParams.set("state", state);
  if (scope !== "all") currentParams.set("scope", scope);
  if (selectedCampaign) currentParams.set("campaign", selectedCampaign);
  if (selectedMailbox) currentParams.set("mailbox", selectedMailbox);
  if (q) currentParams.set("q", q);
  if (autoPingFilter === "attention") currentParams.set("autoping", "attention");
  const linkFor = (messageId: string) => { const params = new URLSearchParams(currentParams); params.set("thread", messageId); return `/app/inbox?${params.toString()}`; };

  const futureFollowups = active ? active.anchor.campaign.followupSteps.flatMap((step) => {
    const existing = active.group.find((message) => message.step === step.stepNumber);
    if (existing?.sentAt) return [];
    const previous = active.group.find((message) => message.step === step.stepNumber - 1);
    const dueAt = previous?.sentAt ? new Date(previous.sentAt.getTime() + step.daysAfterPrevious * 24 * 60 * 60_000) : null;
    return [{ ...step, dueAt, queued: Boolean(existing) }];
  }) : [];

  return (
    <div className="-m-5 h-[calc(100dvh-4rem)] overflow-hidden bg-[#f4f6f5] md:-m-8 md:h-dvh">
      <div className="grid h-full overflow-hidden lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className={`${active ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-line bg-white`}>
          <div className="shrink-0 border-b border-line px-4 pb-3 pt-5">
            <div className="flex items-center justify-between gap-3">
              <div><h1 className="text-xl font-bold text-slate-900">Inbox</h1><p className="metric-number mt-0.5 text-xs text-ink-500">{visible.length} коммуникаций</p></div>
              <Link href="/app/analytics" className="text-xs font-semibold text-ink-500 hover:text-slate-900">Главная →</Link>
            </div>
            <div className="mt-4 flex gap-2">
              <form action="/app/inbox" method="get" className="relative min-w-0 flex-1">
                {state !== "active" && <input type="hidden" name="state" value={state} />}
                {scope !== "all" && <input type="hidden" name="scope" value={scope} />}
                {selectedCampaign && <input type="hidden" name="campaign" value={selectedCampaign} />}
                {selectedMailbox && <input type="hidden" name="mailbox" value={selectedMailbox} />}
                {autoPingFilter === "attention" && <input type="hidden" name="autoping" value="attention" />}
                <svg aria-hidden viewBox="0 0 20 20" className="absolute left-3 top-2.5 h-4 w-4 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8.5" cy="8.5" r="5"/><path d="m12.2 12.2 4 4" strokeLinecap="round"/></svg>
                <input name="q" defaultValue={q} aria-label="Поиск по Inbox" placeholder="Поиск" className="h-9 w-full rounded-lg border border-line bg-surface/60 pl-9 pr-3 text-sm outline-none focus:border-mint-400 focus:bg-white" />
              </form>
              <InboxFilters campaigns={campaignOptions.map((item) => ({ value: item.id, label: item.name }))} mailboxes={mailboxOptions.map((item) => ({ value: item.id, label: item.email }))} selectedCampaign={selectedCampaign} selectedMailbox={selectedMailbox} selectedState={state} selectedScope={scope} query={q} autoPingFilter={autoPingFilter} />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!visible.length && <div className="p-8 text-center text-sm text-ink-500">В этой выборке нет коммуникаций.</div>}
            {visible.map((conversation) => {
              const { anchor, lead } = conversation;
              const needsAction = conversation.unanswered && !lead?.processedAt && !conversation.refusedAt;
              const isActive = active?.key === conversation.key;
              return <Link key={conversation.key} href={linkFor(anchor.id)} className={`block border-b border-line px-4 py-3.5 transition hover:bg-surface/60 ${isActive ? "bg-mint-50" : "bg-white"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <span className={`min-w-0 truncate text-sm ${needsAction ? "font-bold text-slate-900" : "font-semibold text-ink-700"}`}>{anchor.contact.name ?? anchor.contact.email}</span>
                    {lead && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${qualification[lead.qualification].className}`}>{qualification[lead.qualification].label}</span>}
                    {conversation.frozen && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">Мороз</span>}
                    {conversation.autoPingState === "exhausted" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">Автопинг завершён</span>}
                    {conversation.refusedAt && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Отказ</span>}
                    {lead?.processedAt && <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-ink-500">Обработан</span>}
                    {needsAction && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-ink-600">Нужен ответ</span>}
                    {!conversation.hasInbound && <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[10px] font-medium text-ink-500">Без ответа</span>}
                  </div>
                  <time className="metric-number shrink-0 text-[10px] text-ink-500">{formatListDate(conversation.lastEventAt)}</time>
                </div>
                <p className="mt-1 truncate text-xs font-medium text-ink-700">{anchor.subject}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-500">{conversation.timeline.at(-1)?.body ?? anchor.body}</p>
                <p className="mt-2 truncate text-[10px] text-ink-500">{anchor.campaign.name}</p>
              </Link>;
            })}
          </div>
        </aside>

        <main className={`${active ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col overflow-hidden bg-[#eef2ef]`}>
          {!active ? (
            <div className="m-auto max-w-sm px-8 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-white text-xl">✉</span><h2 className="mt-4 font-semibold text-slate-900">Выберите коммуникацию</h2><p className="mt-1 text-sm text-ink-500">Переписка, будущие follow-up и действия по лиду откроются здесь.</p></div>
          ) : (
            <>
              <header className="z-10 shrink-0 border-b border-line bg-white/95 px-5 py-3.5 backdrop-blur">
                <div className="min-w-0">
                    <Link href={`/app/inbox${currentParams.size ? `?${currentParams.toString()}` : ""}`} className="mb-2 inline-flex text-xs font-medium text-ink-500 hover:text-slate-900 lg:hidden">← Все коммуникации</Link>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold text-slate-900">{active.anchor.contact.name ?? active.anchor.contact.email}</h2>
                      {active.lead && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${qualification[active.lead.qualification].className}`}>{qualification[active.lead.qualification].label}</span>}
                      {active.frozen && <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800">Мороз</span>}
                      {active.autoPingState === "exhausted" && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Автопинг завершён</span>}
                      {active.refusedAt && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">Отказ</span>}
                      {active.lead?.processedAt && <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink-500">Обработан</span>}
                      {active.unanswered && !active.lead?.processedAt && !active.refusedAt && <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-ink-600">Нужен ответ</span>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-500">{active.anchor.contact.email}{active.anchor.contact.company ? ` · ${active.anchor.contact.company}` : ""} · {active.anchor.campaign.name}</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  {active.lead && <ProcessedLeadButton leadId={active.lead.id} processed={Boolean(active.lead.processedAt)} />}
                  {active.hasInbound && <form action={toggleConversationAi} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink-700 shadow-sm transition hover:bg-surface"><input type="hidden" name="messageId" value={active.anchor.id} /><span>Ответы только вручную</span><button type="submit" role="switch" aria-checked={!active.anchor.aiRepliesEnabled} aria-label={active.anchor.aiRepliesEnabled ? "Включить ответы только вручную" : "Разрешить ответы ИИ"} className={`relative h-5 w-9 shrink-0 rounded-full transition ${active.anchor.aiRepliesEnabled ? "bg-slate-200" : "bg-mint-500"}`}><span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${active.anchor.aiRepliesEnabled ? "translate-x-0" : "translate-x-4"}`} /></button></form>}
                  {active.frozen && active.autoPingState !== "exhausted" && !active.refusalSuggestedAt && <ConversationAutoPing messageId={active.anchor.id} initialMode={active.anchor.autoPingEnabled === null ? "inherit" : active.anchor.autoPingEnabled ? "enabled" : "disabled"} initialInterval={active.anchor.autoPingIntervalDays ?? workspace.owner.autoPingIntervalDays} maxAttempts={active.anchor.autoPingMaxAttempts ?? workspace.owner.autoPingMaxAttempts} sentAttempts={active.anchor.autoPingAttempts} globalEnabled={workspace.owner.autoPingEnabled} />}
                  {active.lead && <>
                  {active.lead.pushedToCrm && active.lead.crmEntityId ? <span className="rounded-full bg-mint-50 px-2.5 py-1.5 text-xs font-semibold text-mint-800">В Битрикс24{active.lead.handoffTrigger ? ` · ${triggerLabel(active.lead.handoffTrigger)}` : ""}</span> : hasBitrix ? <PushToCrmButton leadId={active.lead.id} /> : null}
                  {hasTelegram && <TelegramLeadButton leadId={active.lead.id} />}
                  </>}
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div className="mx-auto max-w-4xl px-4 py-4 sm:px-7">
                  {active.refusalSuggestedAt && !active.refusedAt && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4"><p className="text-sm font-semibold text-rose-900">ИИ распознал отказ</p><p className="mt-1 text-xs leading-relaxed text-rose-800/80">Подтвердите, чтобы остановить все будущие письма этому контакту и перенести коммуникацию в «Отказы».</p><div className="mt-3 flex gap-2"><form action={confirmConversationRefusal}><input type="hidden" name="messageId" value={active.anchor.id} /><button className="rounded-full bg-rose-700 px-4 py-2 text-xs font-semibold text-white">Подтвердить отказ</button></form><form action={dismissConversationRefusal}><input type="hidden" name="messageId" value={active.anchor.id} /><button className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-800">Это не отказ</button></form></div></div>}
                  {active.refusedAt && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">Коммуникация остановлена: контакт находится в папке «Отказы» и стоп-листе.</div>}
                  {active.frozen && active.autoPingState === "exhausted" && <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-950">Все попытки автопинга закончились</p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-900/80">Клиент не ответил после <span className="metric-number">{active.anchor.autoPingAttempts}</span> сообщений. Пометьте коммуникацию как отказ или задайте новую частоту и продолжите автопинг.</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <form action={confirmConversationRefusal}><input type="hidden" name="messageId" value={active.anchor.id} /><button className="h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50">Пометить как отказ</button></form>
                      <ConversationAutoPing messageId={active.anchor.id} initialMode={active.anchor.autoPingEnabled === null ? "inherit" : active.anchor.autoPingEnabled ? "enabled" : "disabled"} initialInterval={active.anchor.autoPingIntervalDays ?? workspace.owner.autoPingIntervalDays} maxAttempts={active.anchor.autoPingMaxAttempts ?? workspace.owner.autoPingMaxAttempts} sentAttempts={active.anchor.autoPingAttempts} globalEnabled={workspace.owner.autoPingEnabled} exhausted />
                    </div>
                  </div>}
                  {active.lead?.summary && <div className="mb-3 rounded-2xl border border-mint-200 bg-white/85 px-4 py-3 shadow-sm"><p className="text-xs font-semibold text-mint-800">Резюме ИИ</p><p className="mt-1 text-sm leading-relaxed text-ink-700">{active.lead.summary}</p></div>}
                  {!active.hasInbound && <div className="mb-3 rounded-2xl border border-line bg-white/85 p-4 shadow-sm"><p className="text-sm font-semibold text-slate-900">Клиент пока не ответил</p><p className="mt-1 text-xs leading-relaxed text-ink-500">Ручной ответ откроется после первого входящего письма. До этого коммуникацию продолжает настроенная цепочка.</p>{futureFollowups.length > 0 ? <div className="mt-4 space-y-2">{futureFollowups.map((step) => <div key={step.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2.5"><div><p className="text-xs font-semibold text-slate-800">Follow-up {step.stepNumber}</p><p className="mt-0.5 line-clamp-1 text-[11px] text-ink-500">{step.subject}</p></div><span className="metric-number shrink-0 text-[11px] font-medium text-ink-500">{step.queued ? "В очереди" : step.dueAt ? step.dueAt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) : `через ${step.daysAfterPrevious} дн.`}</span></div>)}</div> : <p className="mt-3 text-xs text-ink-500">Будущих follow-up нет.</p>}</div>}
                  <EmailThread thread={active.timeline} />
                  {active.autoPingDraft?.scheduledAt && (
                    <ScheduledAutoPingDraft
                      messageId={active.anchor.id}
                      replyId={active.autoPingDraft.id}
                      initialBody={active.autoPingDraft.body}
                      scheduledAt={active.autoPingDraft.scheduledAt.toISOString()}
                      canEdit={canReply}
                    />
                  )}
                  {canReply ? active.drafts.map((draft) => <DraftReplyEditor key={draft.id} replyId={draft.id} initialBody={draft.body} action={approveDraftReply} />) : active.drafts.length ? <div className="mb-5"><PermissionDeniedButton label="Одобрить и отправить ответ" className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700" /></div> : null}
                </div>
              </div>
              {canReply && active.hasInbound && !active.drafts.length && !active.refusedAt && !active.refusalSuggestedAt && !active.lead?.handedOffAt && !active.lead?.processedAt && <InboxReplyComposer messageId={active.anchor.id} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
