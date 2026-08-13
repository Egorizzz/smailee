import Link from "next/link";
import { requireCapability } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { PAID_PLAN_KEYS, PLANS, isPlanActive, limitsFor, planDisplayName } from "@/lib/plans";
import { startPayment } from "./actions";
import { getEmailQuotaUsage } from "@/server/limits";

export default async function BillingPage() {
  const { owner: user } = await requireCapability("BILLING_MANAGE");
  const active = isPlanActive(user.plan, user.planExpiresAt);
  const limits = limitsFor(user.plan, user.planExpiresAt);

  const [contacts, emailUsage, payments] = await Promise.all([
    prisma.contact.count({ where: { userId: user.id } }),
    getEmailQuotaUsage(user),
    prisma.payment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  const sentThisMonth = emailUsage.used;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900">Тариф и оплата</h1>
      <p className="mt-1 text-ink-500">Текущий доступ, использование лимитов и история платежей.</p>

      {!active && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <div className="font-semibold">Срок доступа завершён</div>
          <p className="mt-1">Все данные сохранены, но создание контактов, запуск и отправка кампаний приостановлены до оплаты.</p>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-line bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-ink-500">Текущий доступ</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{planDisplayName(user)}</div>
            {user.planExpiresAt && (
              <div className="mt-1 text-sm text-ink-500">
                {active ? "Действует" : "Действовал"} до {user.planExpiresAt.toLocaleDateString("ru-RU")}
              </div>
            )}
          </div>
          {user.isDemo && active && (
            <span className="rounded-full border border-mint-200 bg-mint-50 px-3 py-1 text-xs font-semibold text-mint-700">
              Бесплатный доступ на 14 дней
            </span>
          )}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Usage label="Контакты" used={contacts} max={active ? limits.maxContacts : null} />
          <Usage label="Писем в этом месяце" used={sentThisMonth} max={active ? limits.maxEmailsPerMonth : null} />
        </div>
      </div>

      <div className="mt-8">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold text-slate-900">Выберите рабочий объём</h2>
          <p className="mt-1 text-sm text-ink-500">Бесплатного тарифа нет. После окончания срока кабинет остаётся доступен для просмотра, но рассылки останавливаются.</p>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          {PAID_PLAN_KEYS.map((planKey) => {
            const plan = PLANS[planKey];
            const recommended = planKey === "START";
            const current = active && user.plan === planKey;
            return (
              <article
                key={planKey}
                className={`relative flex flex-col rounded-2xl border bg-white p-6 ${recommended ? "border-mint-400 shadow-[0_18px_45px_rgba(14,159,110,0.10)]" : "border-line"}`}
              >
                {recommended && (
                  <span className="absolute right-5 top-5 rounded-full bg-mint-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-mint-700">Рекомендуем</span>
                )}
                <div className="text-sm font-semibold uppercase tracking-wide text-slate-900">{plan.name}</div>
                <div className="mt-4 flex items-end gap-1">
                  <span className="text-4xl font-bold tracking-tight text-slate-900">{plan.priceRub.toLocaleString("ru-RU")}</span>
                  <span className="mb-1 text-ink-500">₽/мес</span>
                </div>
                <ul className="mt-5 flex-1 space-y-2 text-sm text-ink-700">
                  <li>✓ До {plan.maxContacts.toLocaleString("ru-RU")} контактов</li>
                  <li>✓ До {plan.maxEmailsPerMonth.toLocaleString("ru-RU")} писем/мес</li>
                  <li>✓ ИИ-письма, диалоги и квалификация лидов</li>
                </ul>
                <form action={startPayment} className="mt-6">
                  <input type="hidden" name="plan" value={planKey} />
                  <button className={`w-full rounded-lg px-4 py-3 text-sm font-semibold ${recommended ? "brand-gradient text-white" : "border border-line text-slate-900 hover:border-mint-400"}`}>
                    {current ? "Продлить" : `Оплатить ${plan.priceRub.toLocaleString("ru-RU")} ₽`}
                  </button>
                </form>
                <p className="mt-2 text-center text-[11px] text-ink-500">Нажимая кнопку, вы принимаете <Link href="/terms" className="underline">оферту</Link>.</p>
              </article>
            );
          })}
        </div>
      </div>

      {payments.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-xl border border-line bg-white">
          <div className="scroll-x">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-surface text-ink-500"><tr><th className="px-4 py-3 font-medium">Дата</th><th className="px-4 py-3 font-medium">План</th><th className="px-4 py-3 font-medium">Сумма</th><th className="px-4 py-3 font-medium">Статус</th></tr></thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-line">
                    <td className="px-4 py-3 text-ink-700">{payment.createdAt.toLocaleString("ru-RU")}</td>
                    <td className="px-4 py-3 text-slate-900">{PLANS[payment.plan].name}</td>
                    <td className="px-4 py-3 text-ink-700">{(payment.amount / 100).toLocaleString("ru-RU")} ₽</td>
                    <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-xs ${payment.status === "CONFIRMED" ? "bg-mint-100 text-mint-700" : payment.status === "PENDING" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600"}`}>{payment.status === "CONFIRMED" ? "Оплачен" : payment.status === "PENDING" ? "Ожидает оплаты" : "Ошибка"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-3 text-xs text-ink-500">Платёжный шлюз пока не подключён: платёж создаётся в статусе «Ожидает оплаты», а администратор может подтвердить его вручную.</p>
        </div>
      )}
    </div>
  );
}

function Usage({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="text-sm text-ink-500">{label}</div>
      <div className="mt-1 font-semibold text-slate-900">{used.toLocaleString("ru-RU")} {max ? `/ ${max.toLocaleString("ru-RU")}` : "· доступ приостановлен"}</div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface"><div className={pct >= 90 ? "h-full bg-red-400" : "h-full brand-gradient"} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
