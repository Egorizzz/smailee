import Link from "next/link";
import { can, campaignScope, requireWorkspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { PermissionDeniedButton } from "@/components/PermissionDeniedButton";
import { toggleCampaignArchive } from "./actions";

const statusLabels: Record<string, string> = {
  DRAFT: "Черновик",
  SCHEDULED: "Запланирована",
  QUEUED: "В очереди",
  SENDING: "Отправляется",
  SENT: "Отправлена",
  PAUSED: "Пауза",
};

const statusClasses: Record<string, string> = {
  DRAFT: "border-slate-200 bg-slate-50 text-slate-600",
  SCHEDULED: "border-sky-200 bg-sky-50 text-sky-700",
  QUEUED: "border-amber-200 bg-amber-50 text-amber-700",
  SENDING: "border-blue-200 bg-blue-50 text-blue-700",
  SENT: "border-mint-200 bg-mint-50 text-mint-700",
  PAUSED: "border-orange-200 bg-orange-50 text-orange-700",
};

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const workspace = await requireWorkspace();
  const user = workspace.owner;
  const { view } = await searchParams;
  const archived = view === "archived";
  const campaigns = await prisma.campaign.findMany({
    where: { userId: user.id, ...campaignScope(workspace), archivedAt: archived ? { not: null } : null },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">Кампании</h1>
          <p className="mt-1 text-ink-500">Рассылки и их статус</p>
        </div>
        {can(workspace, "CAMPAIGNS_CREATE") ? <Link
          href="/app/campaigns/new"
          className="shrink-0 rounded-lg brand-gradient px-5 py-2.5 text-center text-sm font-semibold text-white"
        >
          + Новая кампания
        </Link> : <PermissionDeniedButton label="+ Новая кампания" className="shrink-0 rounded-lg brand-gradient px-5 py-2.5 text-center text-sm font-semibold text-white" />}
      </div>

      <div className="mt-6 flex gap-1 border-b border-line">
        <Link href="/app/campaigns" className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${!archived ? "border-mint-500 text-slate-900" : "border-transparent text-ink-500"}`}>Активные</Link>
        <Link href="/app/campaigns?view=archived" className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${archived ? "border-mint-500 text-slate-900" : "border-transparent text-ink-500"}`}>Архив</Link>
      </div>

      <div className="mt-4 space-y-2">
        {campaigns.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-white p-10 text-center text-ink-500">
            Пока нет кампаний. Создайте первую — AI напишет письма.
          </div>
        )}
        {campaigns.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-xl border border-line bg-white p-4 transition hover:border-slate-300">
            <Link href={`/app/campaigns/${c.id}`} className="min-w-0 flex-1">
              <span className="font-semibold text-slate-900">{c.name}</span>
              <div className="metric-number mt-1 truncate text-sm text-ink-500">
                {c.subject} · {(c.isDemo ? c.demoAudienceSize : c._count.messages) ?? c._count.messages} писем
                {c.isDemo ? ` · ${c.demoGeneratedCount ?? c._count.messages} примеров` : ""}
              </div>
            </Link>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses[c.status] ?? "border-line bg-surface text-ink-700"}`}>{statusLabels[c.status] ?? c.status}</span>
            <form action={toggleCampaignArchive}><input type="hidden" name="id" value={c.id} /><button className="rounded-md px-2 py-1 text-xs font-medium text-ink-500 hover:bg-surface hover:text-slate-900">{archived ? "Вернуть" : "В архив"}</button></form>
          </div>
        ))}
      </div>
    </div>
  );
}
