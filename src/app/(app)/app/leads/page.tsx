import Link from "next/link";
import { can, requireWorkspace, workspaceHome } from "@/lib/organization";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { EmailThread } from "@/components/EmailThread";
import { DraftReplyEditor } from "@/components/DraftReplyEditor";
import { PushToCrmButton } from "@/components/PushToCrmButton";
import { approveDraftReply } from "../campaigns/[id]/actions";
import { reopenSetup } from "../setup/actions";
import { triggerLabel } from "@/lib/crm/handoffTriggers";
import { PermissionDeniedButton } from "@/components/PermissionDeniedButton";

/**
 * Лиды — ГЛАВНЫЙ экран продукта (TO BE, R1): все реальные диалоги с
 * ответившими по всем кампаниям + квалификация + модерация ИИ-ответов +
 * аналитика воронки. Слито из бывших «Инбокс» и «Лиды»: ежедневный сценарий
 * «проверить ответы и одобрить» — один экран, одобрение в 1 клик.
 *
 * Прогрев сюда не попадает структурно: inboundEngine для прогревочных писем
 * не создаёт Message/ReplyMessage/Lead вообще (M4).
 */

const qualLabels: Record<string, { label: string; cls: string }> = {
  HOT: { label: "Тёплый", cls: "bg-mint-100 text-mint-700" },
  COLD: { label: "Холодный", cls: "bg-surface text-ink-500" },
  IRRELEVANT: { label: "Нецелевой", cls: "bg-surface text-ink-500" },
  UNKNOWN: { label: "Не определён", cls: "bg-surface text-ink-500" },
};

type Filter = "pending" | "hot" | "all";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; setupRequested?: string }>;
}) {
  const workspace = await requireWorkspace();
  const user = workspace.owner;
  const canSeeAll = can(workspace, "LEADS_VIEW_ALL") || can(workspace, "LEADS_REPLY_ALL");
  const canSeeOwn = can(workspace, "LEADS_REPLY_OWN");
  const canReply = can(workspace, "LEADS_REPLY_ALL") || can(workspace, "LEADS_REPLY_OWN");
  if (!canSeeAll && !canSeeOwn) redirect(workspaceHome(workspace));
  const campaignWhere = { userId: user.id, ...(canSeeAll ? {} : { createdById: workspace.actor.id }) };
  const { f, setupRequested } = await searchParams;

  // настройка не завершена, но визард закрыт крестиком → ненавязчивый баннер
  const [mbCount, ctCount, cpCount] = await Promise.all([
    prisma.mailbox.count({ where: { userId: user.id } }),
    prisma.contact.count({ where: { userId: user.id } }),
    prisma.campaign.count({ where: campaignWhere }),
  ]);
  const setupIncomplete =
    !(user.offer && user.targetAudience) || mbCount === 0 || ctCount === 0 || cpCount === 0;

  // ── Аналитика воронки (стандартные метрики кампаний, TO BE R1) ──
  const [sent, delivered, opened, replied, hotLeads, supByReason] = await Promise.all([
    prisma.message.count({
      where: { campaign: campaignWhere, status: { in: ["SENT", "DELIVERED", "OPENED", "CLICKED", "REPLIED"] } },
    }),
    prisma.message.count({
      where: { campaign: campaignWhere, status: { in: ["DELIVERED", "OPENED", "CLICKED", "REPLIED"] } },
    }),
    prisma.message.count({ where: { campaign: campaignWhere, openedAt: { not: null } } }),
    prisma.message.count({ where: { campaign: campaignWhere, repliedAt: { not: null } } }),
    prisma.lead.count({ where: { userId: user.id, qualification: "HOT", message: { campaign: campaignWhere } } }),
    // возвращённые оператором вручную не считаем — это уже не активный негатив
    prisma.suppression.groupBy({ by: ["reason"], where: { userId: user.id, releasedAt: null }, _count: true }),
  ]);

  const supCount = (reason: string) => supByReason.find((s) => s.reason === reason)?._count ?? 0;
  const bounced = supCount("bounced");
  const complained = supCount("complained");
  // Отписки по клику (старый механизм, ссылку больше не рассылаем — раздел
  // «Про отписку» ниже) и явные отказы прямо в переписке считаем вместе:
  // для клиента это один и тот же смысл — «просили больше не писать».
  const unsubscribed = supCount("unsubscribed") + supCount("declined_via_reply");
  const pct = (n: number, base: number) => (base ? `${Math.round((n / base) * 100)}%` : "—");

  // ── Диалоги: все письма с тредом ──
  const messages = await prisma.message.findMany({
    where: { campaign: campaignWhere, thread: { some: {} } },
    include: {
      contact: true,
      campaign: { select: { id: true, name: true } },
      thread: { orderBy: { createdAt: "asc" } },
      lead: true,
    },
  });

  // сортировка по последней активности треда
  messages.sort((a, b) => {
    const aLast = a.thread[a.thread.length - 1]?.createdAt ?? a.createdAt;
    const bLast = b.thread[b.thread.length - 1]?.createdAt ?? b.createdAt;
    return bLast.getTime() - aLast.getTime();
  });

  const hasDraft = (m: (typeof messages)[number]) =>
    m.thread.some((t) => t.direction === "outbound" && t.status === "DRAFT");
  const pendingCount = messages.filter(hasDraft).length;
  const hotCount = messages.filter((m) => m.lead?.qualification === "HOT").length;
  // без вебхука кнопка вела бы в тупик (pushLeadManually сразу вернёт ошибку)
  const hasBitrix = Boolean(user.bitrixWebhookEnc);

  // дефолтный фильтр: если есть ждущие одобрения — показываем их первыми
  const filter: Filter =
    f === "hot" || f === "all" || f === "pending" ? (f as Filter) : pendingCount > 0 ? "pending" : "all";

  const visible = messages.filter((m) => {
    if (filter === "pending") return hasDraft(m);
    if (filter === "hot") return m.lead?.qualification === "HOT";
    return true;
  });

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "pending", label: "Ждут одобрения", count: pendingCount },
    { key: "hot", label: "Тёплые", count: hotCount },
    { key: "all", label: "Все", count: messages.length },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900">Лиды</h1>
      <p className="mt-1 text-ink-500">
        Все диалоги с ответившими по всем кампаниям. ИИ квалифицирует, вы одобряете
        ответы — тёплые уходят в CRM.
      </p>

      {setupRequested && (
        <div className="mt-4 rounded-lg border border-mint-400 bg-mint-100/40 px-4 py-3 text-sm text-mint-700">
          Заявка отправлена — специалист свяжется с вами для онлайн-настройки.
        </div>
      )}

      {setupIncomplete && !setupRequested && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <span className="text-sm text-indigo-700">
            Настройка не завершена — лиды начнут появляться после запуска первой кампании.
          </span>
          <form action={reopenSetup}>
            <button className="rounded-lg brand-gradient px-4 py-2 text-xs font-semibold text-white">
              Продолжить настройку →
            </button>
          </form>
        </div>
      )}

      {/* воронка + метрики (стандартная аналитика кампаний) */}
      <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {[
          { l: "Отправлено", v: sent },
          { l: "Доставлено", v: delivered, sub: pct(delivered, sent) },
          { l: "Open rate", v: pct(opened, sent), sub: `${opened} откр.` },
          { l: "Reply rate", v: pct(replied, sent), sub: `${replied} отв.` },
          { l: "Тёплых лидов", v: hotLeads, sub: pct(hotLeads, sent), hot: true },
        ].map((s) => (
          <div key={s.l} className={`rounded-xl border p-3 ${s.hot ? "border-mint-400 bg-mint-100/40" : "border-line bg-white"}`}>
            <div className="text-lg font-bold text-slate-900">{s.v}</div>
            <div className="text-xs text-ink-500">
              {s.l}
              {s.sub ? <span className="text-ink-500/70"> · {s.sub}</span> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-xs text-ink-500">
        Негатив: отписки {unsubscribed} · жалобы {complained} · недоставлено {bounced} —{" "}
        <Link href="/app/contacts?tab=suppressions" className="underline hover:text-slate-900">
          стоп-лист
        </Link>
      </div>

      {!user.bitrixWebhookEnc && hotLeads > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Битрикс24 не подключён — тёплые лиды остаются только здесь.{" "}
          <Link href="/app/settings" className="font-semibold underline">
            Подключить в настройках
          </Link>
        </div>
      )}

      {/* фильтры */}
      <div className="mt-6 flex flex-wrap gap-2">
        {filters.map((fl) => (
          <Link
            key={fl.key}
            href={`/app/leads?f=${fl.key}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              filter === fl.key
                ? "brand-gradient text-white"
                : "border border-line bg-white text-ink-700 hover:border-mint-400"
            }`}
          >
            {fl.label} · {fl.count}
          </Link>
        ))}
      </div>

      {/* диалоги */}
      <div className="mt-4 space-y-3">
        {visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-white p-10 text-center text-ink-500">
            {messages.length === 0
              ? "Пока нет диалогов. Как только лид ответит на письмо кампании, переписка появится здесь."
              : "В этом фильтре пусто."}
          </div>
        )}
        {visible.map((m) => {
          const q = m.lead ? qualLabels[m.lead.qualification] ?? qualLabels.UNKNOWN : null;
          return (
            <div id={m.lead ? `lead-${m.lead.id}` : undefined} key={m.id} className="scroll-mt-6 rounded-xl border border-line bg-white p-5 target:border-mint-400 target:ring-2 target:ring-mint-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">
                    {m.contact.name ?? m.contact.email}
                    {m.contact.company && <span className="text-ink-500"> · {m.contact.company}</span>}
                  </div>
                  <div className="mt-0.5 text-sm text-ink-500">{m.contact.email}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {q && (
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${q.cls}`}>{q.label}</span>
                  )}
                  {m.lead?.pushedToCrm && m.lead.crmEntityId ? (
                    <span className="text-xs text-indigo-600">
                      → в Битрикс24
                      {m.lead.handoffTrigger && ` · ${triggerLabel(m.lead.handoffTrigger)}`}
                    </span>
                  ) : (
                    m.lead &&
                    hasBitrix && <PushToCrmButton leadId={m.lead.id} />
                  )}
                  <Link
                    href={`/app/campaigns/${m.campaign.id}`}
                    className="text-xs text-ink-500 hover:text-indigo-600"
                  >
                    {m.campaign.name} →
                  </Link>
                </div>
              </div>

              {m.lead?.summary && (
                <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm text-ink-700">{m.lead.summary}</p>
              )}

              <EmailThread thread={m.thread} />

              {/* модерация ИИ-ответа — 1 клик прямо здесь (§5.5) */}
              {canReply ? m.thread
                .filter((t) => t.direction === "outbound" && t.status === "DRAFT")
                .map((draft) => (
                  <DraftReplyEditor
                    key={draft.id}
                    replyId={draft.id}
                    initialBody={draft.body}
                    action={approveDraftReply}
                  />
                )) : m.thread.some((t) => t.direction === "outbound" && t.status === "DRAFT") ? <div className="mt-3"><PermissionDeniedButton label="Одобрить и отправить ответ" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700" /></div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
