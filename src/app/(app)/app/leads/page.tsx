import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBitrixLive } from "@/lib/services/bitrix";
import { EmailThread } from "@/components/EmailThread";

const qualLabels: Record<string, { label: string; cls: string }> = {
  HOT: { label: "Тёплый", cls: "bg-mint-100 text-mint-700" },
  COLD: { label: "Холодный", cls: "bg-surface text-ink-500" },
  IRRELEVANT: { label: "Нецелевой", cls: "bg-surface text-ink-500" },
  UNKNOWN: { label: "Не определён", cls: "bg-surface text-ink-500" },
};

export default async function LeadsPage() {
  const user = await requireUser();
  const leads = await prisma.lead.findMany({
    where: { userId: user.id },
    orderBy: [{ qualification: "asc" }, { createdAt: "desc" }],
    include: {
      message: {
        include: {
          contact: true,
          thread: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  const hot = leads.filter((l) => l.qualification === "HOT");

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900">Лиды</h1>
      <p className="mt-1 text-ink-500">
        Тёплые лиды — те, кто ответил и проявил интерес. {hot.length} тёплых из{" "}
        {leads.length}.
      </p>

      {!isBitrixLive && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Битрикс24 в тестовом режиме. Добавьте <code>BITRIX24_WEBHOOK_URL</code>{" "}
          в <code>.env</code>, чтобы тёплые лиды уходили в CRM автоматически.
        </div>
      )}

      <div className="mt-6 space-y-3">
        {leads.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-white p-10 text-center text-ink-500">
            Пока нет лидов. Запустите кампанию — когда клиенты начнут отвечать,
            AI квалифицирует их здесь.
          </div>
        )}
        {leads.map((l) => {
          const q = qualLabels[l.qualification] ?? qualLabels.UNKNOWN;
          return (
            <div key={l.id} className="rounded-xl border border-line bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">
                    {l.message.contact.company ?? l.message.contact.email}
                  </div>
                  <div className="mt-0.5 text-sm text-ink-500">
                    {l.message.contact.email}
                    {l.message.contact.name ? ` · ${l.message.contact.name}` : ""}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${q.cls}`}>
                    {q.label}
                  </span>
                  {l.pushedToCrm && (
                    <span className="text-xs text-indigo-600">→ в Битрикс24</span>
                  )}
                </div>
              </div>
              {l.summary && (
                <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm text-ink-700">
                  {l.summary}
                </p>
              )}
              {l.message.thread.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-ink-500">
                    Показать переписку ({l.message.thread.length})
                  </summary>
                  <EmailThread thread={l.message.thread} />
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
