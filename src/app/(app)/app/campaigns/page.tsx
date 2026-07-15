import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const statusLabels: Record<string, string> = {
  DRAFT: "Черновик",
  SCHEDULED: "Запланирована",
  QUEUED: "В очереди",
  SENDING: "Отправляется",
  SENT: "Отправлена",
  PAUSED: "Пауза",
};

export default async function CampaignsPage() {
  const user = await requireUser();
  const campaigns = await prisma.campaign.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Кампании</h1>
          <p className="mt-1 text-ink-500">Рассылки и их статус</p>
        </div>
        <Link
          href="/app/campaigns/new"
          className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white"
        >
          + Новая кампания
        </Link>
      </div>

      <div className="mt-6 space-y-3">
        {campaigns.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-white p-10 text-center text-ink-500">
            Пока нет кампаний. Создайте первую — AI напишет письма.
          </div>
        )}
        {campaigns.map((c) => (
          <Link
            key={c.id}
            href={`/app/campaigns/${c.id}`}
            className="flex items-center justify-between rounded-xl border border-line bg-white p-5 transition hover:border-mint-400"
          >
            <div>
              <span className="font-semibold text-slate-900">{c.name}</span>
              <div className="mt-1 text-sm text-ink-500">
                {c.subject} · {c._count.messages} писем
              </div>
            </div>
            <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-700">
              {statusLabels[c.status] ?? c.status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
