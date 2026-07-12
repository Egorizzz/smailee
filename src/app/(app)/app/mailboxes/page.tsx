import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supportedProviders } from "@/lib/mail/profiles";
import { hasEncKey } from "@/lib/crypto";
import { MailboxForm } from "./MailboxForm";
import { deleteMailbox, pauseMailbox, resumeMailbox } from "./actions";

const MAX_PER_DOMAIN = 4;

const connLabels: Record<string, { label: string; cls: string }> = {
  ok: { label: "Подключён", cls: "bg-mint-100 text-mint-700" },
  paused: { label: "Ожидает проверки", cls: "bg-amber-50 text-amber-700" },
  auth_error: { label: "Ошибка входа", cls: "bg-red-50 text-red-600" },
  unreachable: { label: "Недоступен", cls: "bg-red-50 text-red-600" },
  disabled: { label: "На паузе (здоровье)", cls: "bg-red-50 text-red-600" },
};

function healthCls(score: number): string {
  if (score >= 80) return "text-mint-700";
  if (score >= 50) return "text-amber-700";
  return "text-red-600";
}

export default async function MailboxesPage() {
  const user = await requireUser();
  const groups = await prisma.domainGroup.findMany({
    where: { userId: user.id },
    orderBy: { domain: "asc" },
    include: { mailboxes: { orderBy: { email: "asc" } } },
  });

  const profiles = supportedProviders();
  const allMailboxes = groups.flatMap((g) => g.mailboxes);
  const totalMailboxes = allMailboxes.length;

  // сводка здоровья флота (§5.8) — healthScore считает computeFleetHealth
  // (тик воркера), здесь только читаем и агрегируем для дашборда
  const okCount = allMailboxes.filter((m) => m.connState === "ok").length;
  const disabledCount = allMailboxes.filter((m) => m.connState === "disabled").length;
  const avgHealth = totalMailboxes
    ? Math.round(allMailboxes.reduce((s, m) => s + m.healthScore, 0) / totalMailboxes)
    : 100;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ящики</h1>
          <p className="mt-1 text-ink-500">
            Пул почтовых ящиков (SMTP+IMAP), с которых идёт рассылка и приём ответов.
            Домены и ящики вы поднимаете сами (модель C), а подключаете сюда.
          </p>
        </div>
        <Link
          href="/app/mailboxes/plan"
          className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700"
        >
          План инфраструктуры
        </Link>
      </div>

      {!hasEncKey() && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          Не задан <code>MAILBOX_ENC_KEY</code> в <code>.env</code> — доступы к ящикам
          не будут зашифрованы. Сгенерируйте ключ: <code>openssl rand -hex 32</code>.
        </div>
      )}

      {totalMailboxes > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { l: "Ящиков всего", v: totalMailboxes },
            { l: "Здоровы (ok)", v: okCount },
            { l: "На паузе", v: disabledCount, cls: disabledCount > 0 ? "text-red-600" : undefined },
            { l: "Средний health score", v: avgHealth, cls: healthCls(avgHealth) },
          ].map((s) => (
            <div key={s.l} className="rounded-xl border border-line bg-white p-4">
              <div className={`text-xl font-bold ${s.cls ?? "text-slate-900"}`}>{s.v}</div>
              <div className="text-sm text-ink-500">{s.l}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6">
        <MailboxForm
          providers={profiles.map((p) => ({ value: p.provider, label: p.label }))}
          passwordHint={profiles[0]?.passwordHint ?? ""}
        />
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-500">
        Подключено ящиков: {totalMailboxes}
      </h2>

      <div className="mt-3 space-y-4">
        {groups.length === 0 && (
          <p className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-ink-500">
            Пока нет ящиков. Добавьте вручную или импортируйте CSV.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.id} className="rounded-xl border border-line bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-slate-900">{g.domain}</div>
              <span className="text-xs text-ink-500">
                {g.mailboxes.length} / {MAX_PER_DOMAIN} ящиков · лимит {g.dailyLimit}/день
              </span>
            </div>
            {g.mailboxes.length > MAX_PER_DOMAIN && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                На домене больше {MAX_PER_DOMAIN} ящиков — это превышает безопасный лимит
                (≤{MAX_PER_DOMAIN} ящика на домен, чтобы не упереться в 120 писем/день).
              </p>
            )}
            <div className="mt-3 space-y-2">
              {g.mailboxes.map((m) => {
                const c = connLabels[m.connState] ?? connLabels.paused;
                return (
                  <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {m.senderName} &lt;{m.email}&gt;
                      </div>
                      <div className="text-xs text-ink-500">
                        холодных сегодня: {m.coldSentToday}/{m.coldDailyLimit} · прогрев: {m.warmupState} ·{" "}
                        <span className={`font-semibold ${healthCls(m.healthScore)}`}>health {m.healthScore}</span>
                      </div>
                      {m.connState === "disabled" && m.pausedReason && (
                        <div className="mt-0.5 text-xs text-red-600">{m.pausedReason}</div>
                      )}
                      {m.connError && m.connState !== "ok" && m.connState !== "disabled" && (
                        <div className="mt-0.5 text-xs text-ink-500">{m.connError}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.cls}`}>{c.label}</span>
                      {m.connState === "disabled" ? (
                        <form action={resumeMailbox}>
                          <input type="hidden" name="id" value={m.id} />
                          <button className="rounded-md border border-mint-200 bg-mint-100 px-2 py-1 text-xs font-semibold text-mint-700">
                            Возобновить
                          </button>
                        </form>
                      ) : (
                        <form action={pauseMailbox}>
                          <input type="hidden" name="id" value={m.id} />
                          <button className="rounded-md border border-line px-2 py-1 text-xs text-ink-700 hover:border-red-200 hover:text-red-600">
                            Приостановить
                          </button>
                        </form>
                      )}
                      <form action={deleteMailbox}>
                        <input type="hidden" name="id" value={m.id} />
                        <button className="rounded-md px-2 py-1 text-xs text-ink-500 hover:text-red-500" aria-label={`Удалить ${m.email}`}>
                          ✕
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
