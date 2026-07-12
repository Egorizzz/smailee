import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmailThread } from "@/components/EmailThread";
import { approveDraftReply, simulateReply } from "../campaigns/[id]/actions";

/**
 * Единый инбокс (ТЗ §5.7): только реальные ответы людей — прогрев уже не
 * попадает сюда структурно, а не через фильтр здесь. inboundEngine
 * (src/server/inboundEngine.ts, M3/M4) при детекте маркера прогрева пишет
 * ТОЛЬКО в WarmupEvent и не создаёт Message/ReplyMessage/Lead — реальный
 * инбокс чист по построению.
 *
 * Переиспользует то, что уже есть: EmailThread (карточка диалога),
 * approveDraftReply (модерация ответов ИИ, §5.5, M3) — те же формы, что и в
 * карточке кампании, просто собраны в один список по всем кампаниям клиента.
 */

const qualLabels: Record<string, { label: string; cls: string }> = {
  HOT: { label: "Тёплый", cls: "bg-mint-100 text-mint-700" },
  COLD: { label: "Холодный", cls: "bg-surface text-ink-500" },
  IRRELEVANT: { label: "Нецелевой", cls: "bg-surface text-ink-500" },
  UNKNOWN: { label: "Не определён", cls: "bg-surface text-ink-500" },
};

export default async function InboxPage() {
  const user = await requireUser();

  const messages = await prisma.message.findMany({
    where: { campaign: { userId: user.id }, thread: { some: {} } },
    include: {
      contact: true,
      campaign: { select: { id: true, name: true } },
      thread: { orderBy: { createdAt: "asc" } },
      lead: true,
    },
  });

  // сортировка по времени последней активности в треде (не по созданию письма)
  messages.sort((a, b) => {
    const aLast = a.thread[a.thread.length - 1]?.createdAt ?? a.createdAt;
    const bLast = b.thread[b.thread.length - 1]?.createdAt ?? b.createdAt;
    return bLast.getTime() - aLast.getTime();
  });

  const pendingDrafts = messages.filter((m) =>
    m.thread.some((t) => t.direction === "outbound" && t.status === "DRAFT")
  ).length;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900">Инбокс</h1>
      <p className="mt-1 text-ink-500">
        Все реальные диалоги с ответившими, по всем кампаниям. Прогрев сюда не
        попадает — это служебная переписка между ящиками пула, не лиды.
        {pendingDrafts > 0 && (
          <span className="ml-1 font-medium text-amber-700">
            {pendingDrafts} {pendingDrafts === 1 ? "ответ ждёт" : "ответов ждут"} одобрения.
          </span>
        )}
      </p>

      <div className="mt-6 space-y-3">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-white p-10 text-center text-ink-500">
            Пока нет диалогов. Как только лид ответит на письмо кампании, переписка появится здесь.
          </div>
        )}
        {messages.map((m) => {
          const q = m.lead ? qualLabels[m.lead.qualification] ?? qualLabels.UNKNOWN : null;
          return (
            <div key={m.id} className="rounded-xl border border-line bg-white p-5">
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
                  <Link
                    href={`/app/campaigns/${m.campaign.id}`}
                    className="text-xs text-ink-500 hover:text-indigo-600"
                  >
                    {m.campaign.name} →
                  </Link>
                </div>
              </div>

              <EmailThread thread={m.thread} />

              {m.thread
                .filter((t) => t.direction === "outbound" && t.status === "DRAFT")
                .map((draft) => (
                  <form key={draft.id} action={approveDraftReply} className="mt-3 flex items-center gap-2">
                    <input type="hidden" name="replyId" value={draft.id} />
                    <span className="text-xs text-ink-500">Ответ ИИ готов, но не отправлен.</span>
                    <button className="shrink-0 rounded-lg brand-gradient px-3 py-1.5 text-xs font-semibold text-white">
                      Одобрить и отправить
                    </button>
                  </form>
                ))}

              {["SENT", "DELIVERED", "OPENED"].includes(m.status) && (
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
