import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { launchCampaign } from "../actions";
import { simulateReply, approveDraftReply } from "./actions";
import { EmailThread } from "@/components/EmailThread";
import { MessagePreview } from "@/components/MessagePreview";
import { DraftReplyEditor } from "@/components/DraftReplyEditor";

export default async function CampaignDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const user = await requireUser();

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: user.id },
    include: {
      messages: {
        include: { contact: true, thread: { orderBy: { createdAt: "asc" } }, lead: true },
        orderBy: { createdAt: "asc" },
        take: 50,
      },
    },
  });
  if (!campaign) notFound();

  const total = campaign.messages.length;
  const sent = campaign.messages.filter((m) =>
    ["SENT", "DELIVERED", "OPENED", "REPLIED"].includes(m.status)
  ).length;
  const replied = campaign.messages.filter((m) => m.repliedAt).length;
  const replyRate = sent ? Math.round((replied / sent) * 100) : 0;

  const canLaunch = campaign.status === "DRAFT" || campaign.status === "PAUSED";

  // R4: прогретые ящики и ожидаемая дата готовности прогрева
  const mailboxes = await prisma.mailbox.findMany({
    where: { userId: user.id, connState: { in: ["ok", "paused"] } },
    select: { warmupState: true, warmupStartedAt: true },
  });
  const warmCount = mailboxes.filter((m) => m.warmupState === "warm").length;
  const warmingStarts = mailboxes
    .filter((m) => m.warmupState === "warming" && m.warmupStartedAt)
    .map((m) => m.warmupStartedAt!.getTime());
  const warmReadyDate =
    warmingStarts.length > 0
      ? new Date(Math.min(...warmingStarts) + config.warmup.rampDays * config.warmup.dayMs)
      : null;
  const waitingWarmup = campaign.status === "SCHEDULED" && campaign.launchAfterWarmup;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/campaigns" className="text-sm text-ink-500 hover:text-slate-900">
        ← Все кампании
      </Link>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
          <p className="mt-1 text-ink-500">{campaign.subject}</p>
        </div>
        {canLaunch && total > 0 && (
          <form action={launchCampaign}>
            <input type="hidden" name="id" value={campaign.id} />
            <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
              {warmCount > 0 ? "▶ Запустить рассылку" : "▶ Запустить после прогрева"}
            </button>
          </form>
        )}
      </div>

      {waitingWarmup && (
        <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
          ⏳ Кампания стартует автоматически, как только ящики прогреются
          {warmReadyDate ? ` — примерно ${warmReadyDate.toLocaleDateString("ru-RU")}` : ""}.
          Прогресс прогрева — в разделе «Инфраструктура».
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

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { l: "Писем", v: total },
          { l: "Отправлено", v: sent },
          { l: "Ответов", v: replied },
          { l: "Reply rate", v: `${replyRate}%` },
        ].map((s) => (
          <div key={s.l} className="rounded-xl border border-line bg-white p-4">
            <div className="text-xl font-bold text-slate-900">{s.v}</div>
            <div className="text-sm text-ink-500">{s.l}</div>
          </div>
        ))}
      </div>

      {total === 0 && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          В кампании нет писем — вероятно, в выбранном сегменте нет контактов.
          Загрузите базу и создайте кампанию заново.
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-slate-900">Письма</h2>
      <div className="mt-3 space-y-3">
        {campaign.messages.map((m) => (
          <div key={m.id} className="rounded-xl border border-line bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-medium text-slate-900">
                  {m.contact.email}
                </span>
                {m.contact.company && (
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

            {/* предпросмотр письма с реальными переменными контакта */}
            <MessagePreview messageId={m.id} />

            {/* email-тред */}
            {m.thread.length > 0 && <EmailThread thread={m.thread} />}

            {/* модерация: черновик AI-ответа ждёт одобрения оператора (§5.5) */}
            {m.thread
              .filter((t) => t.direction === "outbound" && t.status === "DRAFT")
              .map((draft) => (
                <DraftReplyEditor
                  key={draft.id}
                  replyId={draft.id}
                  initialBody={draft.body}
                  action={approveDraftReply}
                />
              ))}

            {/* симуляция ответа — только для отправленных без ответа */}
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
        ))}
      </div>
    </div>
  );
}
