import Link from "next/link";
import { requireCapability } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { supportedProviders } from "@/lib/mail/profiles";
import { hasEncKey } from "@/lib/crypto";
import { config } from "@/lib/config";
import { DELIVERABILITY_RULES, warmupDailyTarget } from "@/lib/mail/deliverabilityRules";
import { calcInfraPlan } from "@/lib/mail/planCalculator";
import { limitsFor, planDisplayName } from "@/lib/plans";
import { MailboxForm } from "./MailboxForm";
import { InfrastructureOnboarding } from "@/components/InfrastructureOnboarding";
import { deleteMailbox, pauseMailbox, resumeMailbox } from "./actions";

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
  const { owner: user } = await requireCapability("INFRASTRUCTURE_MANAGE");
  const [groups, contactCount] = await Promise.all([
    prisma.domainGroup.findMany({
      where: { userId: user.id },
      orderBy: { domain: "asc" },
      include: { mailboxes: { orderBy: { email: "asc" } } },
    }),
    prisma.contact.count({ where: { userId: user.id } }),
  ]);

  const profiles = supportedProviders();
  const allMailboxes = groups.flatMap((g) => g.mailboxes);
  const totalMailboxes = allMailboxes.length;
  const planLimits = limitsFor(user.plan, user.planExpiresAt);
  const tariffName = planDisplayName(user);
  const mailboxQuota = planLimits.mailboxQuota;
  const databasePlan = contactCount > 0 ? calcInfraPlan(contactCount, user.companyName ?? undefined) : null;
  const requiredMailboxes = databasePlan?.mailboxes ?? 0;
  const missingMailboxes = Math.max(0, requiredMailboxes - totalMailboxes);
  const quotaProgress = mailboxQuota > 0 ? Math.min(100, Math.round((totalMailboxes / mailboxQuota) * 100)) : 0;

  // сводка здоровья флота (§5.8) — healthScore считает computeFleetHealth
  // (тик воркера), здесь только читаем и агрегируем для дашборда
  const okCount = allMailboxes.filter((m) => m.connState === "ok").length;
  const disabledCount = allMailboxes.filter((m) => m.connState === "disabled").length;
  const avgHealth = totalMailboxes
    ? Math.round(allMailboxes.reduce((s, m) => s + m.healthScore, 0) / totalMailboxes)
    : 100;

  return (
    <div className="mx-auto max-w-3xl">
      {/* на телефоне заголовок и кнопка не помещаются в одну строку: у кнопки
          shrink-0, а «Инфраструктура» в 24px — неразрывное слово. Складываем
          в столбик до sm, иначе кнопка вылезает за экран */}
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">Инфраструктура</h1>
          <p className="mt-1 text-ink-500">
            Почтовые ящики для отправки писем, приёма ответов и автоматического прогрева.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2"><InfrastructureOnboarding /><Link href="/app/mailboxes/plan" className="rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm font-semibold text-white">План инфраструктуры</Link></div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <div className="grid sm:grid-cols-2">
          <div className="p-5 sm:border-r sm:border-line">
            <div className="text-xs font-semibold text-ink-500">Подключено ящиков</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="metric-number text-3xl font-bold text-slate-900">{totalMailboxes} / {mailboxQuota}</span>
              <span className="text-sm text-ink-500">по тарифу</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface">
              <div className="h-full brand-gradient" style={{ width: `${quotaProgress}%` }} />
            </div>
            <p className="mt-2 text-xs text-ink-500">
              {tariffName} · до {mailboxQuota * DELIVERABILITY_RULES.coldPerMailboxDailyMax} холодных писем в день
            </p>
          </div>

          <div className="border-t border-line p-5 sm:border-t-0">
            <div className="text-xs font-semibold text-ink-500">Для загруженной базы</div>
            {databasePlan ? (
              <>
                <div className="metric-number mt-1 text-3xl font-bold text-slate-900">
                  {requiredMailboxes} {plural(requiredMailboxes, "ящик", "ящика", "ящиков")}
                </div>
                <p className="metric-number mt-1 text-sm text-ink-500">
                  {contactCount.toLocaleString("ru-RU")} {plural(contactCount, "контакт", "контакта", "контактов")} · {databasePlan.domains} {plural(databasePlan.domains, "домен", "домена", "доменов")}
                </p>
                <p className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${missingMailboxes > 0 ? "bg-amber-50 text-amber-700" : "bg-mint-50 text-mint-700"}`}>
                  {missingMailboxes > 0
                    ? `Нужно подключить ещё ${missingMailboxes}`
                    : "Инфраструктуры достаточно"}
                </p>
              </>
            ) : (
              <>
                <div className="mt-1 text-xl font-bold text-slate-900">Расчёт появится после загрузки</div>
                <p className="mt-2 text-sm text-ink-500">Добавьте контакты — мы посчитаем нужные ящики и домены.</p>
              </>
            )}
          </div>
        </div>
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
              <div className={`metric-number text-xl font-bold ${s.cls ?? "text-slate-900"}`}>{s.v}</div>
              <div className="text-sm text-ink-500">{s.l}</div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold text-ink-500">
        Подключено ящиков: {totalMailboxes} / {mailboxQuota} по тарифу
      </h2>

      <div className="mt-3 space-y-4">
        {groups.length === 0 && (
          <p className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-ink-500">
            Пока нет ящиков. Добавьте первый ящик по email и паролю приложения.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.id} className="rounded-xl border border-line bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-slate-900">{g.domain}</div>
              <span className="metric-number text-xs text-ink-500">
                {g.mailboxes.length} на домене · безопасно до {DELIVERABILITY_RULES.mailboxesPerDomainMax} · до {Math.min(g.dailyLimit, DELIVERABILITY_RULES.coldPerDomainDailyMax)}/день
              </span>
            </div>
            {g.mailboxes.length > DELIVERABILITY_RULES.mailboxesPerDomainMax && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                На домене больше {DELIVERABILITY_RULES.mailboxesPerDomainMax} ящиков — это превышает безопасный лимит
                (≤{DELIVERABILITY_RULES.mailboxesPerDomainMax} ящика на домен, чтобы не упереться в {DELIVERABILITY_RULES.coldPerDomainDailyMax} писем/день).
              </p>
            )}
            <div className="mt-3 space-y-2">
              {g.mailboxes.map((m) => {
                const c = connLabels[m.connState] ?? connLabels.paused;
                const warmupSentToday =
                  m.warmupSentDate?.toDateString() === new Date().toDateString() ? m.warmupSentToday : 0;
                const warmupTarget = warmupDailyTarget(Math.max(1, m.warmupDay));
                return (
                  <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {m.senderName} &lt;{m.email}&gt;
                      </div>
                      <div className="metric-number text-xs text-ink-500">
                        холодных сегодня: {m.coldSentToday}/{m.coldDailyLimit} · прогрев сегодня: {warmupSentToday}/{warmupTarget} ·{" "}
                        {m.warmupState === "warm"
                          ? "прогрет ✓"
                          : m.warmupState === "warming"
                            ? `прогрев: день ${m.warmupDay} из ${config.warmup.rampDays}`
                            : "прогрев не начат"}{" "}
                        · <span className={`font-semibold ${healthCls(m.healthScore)}`}>health {m.healthScore}</span>
                      </div>
                      {m.warmupState === "warming" && (
                        <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-surface">
                          <div
                            className="h-full brand-gradient"
                            style={{ width: `${Math.min(100, Math.round((m.warmupDay / config.warmup.rampDays) * 100))}%` }}
                          />
                        </div>
                      )}
                      {m.connState === "disabled" && m.pausedReason && (
                        <div className="mt-0.5 text-xs text-red-600">{m.pausedReason}</div>
                      )}
                      {m.connError && m.connState !== "ok" && m.connState !== "disabled" && (
                        <div className="mt-0.5 text-xs text-ink-500">{m.connError}</div>
                      )}
                      {m.pauseKind === "NETWORK" && m.nextReconnectAt && (
                        <div className="mt-0.5 text-xs text-amber-700">
                          {m.reconnectAttempts < 3
                            ? `Автопроверка подключения: попытка ${m.reconnectAttempts + 1} из 3`
                            : "Следующая автоматическая проверка подключения"}{" "}
                          ·{" "}
                          {m.nextReconnectAt.toLocaleString("ru-RU")}
                        </div>
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
      <div className="mt-5">
        <MailboxForm providers={profiles.map((p) => ({ value: p.provider, label: p.label }))} passwordHint={profiles[0]?.passwordHint ?? ""} />
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
