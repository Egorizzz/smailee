import Link from "next/link";
import { requireCapability } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { PAID_PLAN_KEYS, PLANS, UPLOAD_CONTACT_LIMITS, aiGenerationLimit, isPlanActive, limitsFor, planDisplayName } from "@/lib/plans";
import { startPayment } from "./actions";
import { getEmailQuotaUsage } from "@/server/limits";
import { CancelAutoRenewalButton } from "@/components/CancelAutoRenewalButton";
import { pricingCopy } from "@/content/landing/pricing";

type BillingSearchParams = Promise<{ payment?: string; code?: string }>;

export default async function BillingPage({ searchParams }: { searchParams: BillingSearchParams }) {
  const { owner: user } = await requireCapability("BILLING_MANAGE");
  const query = await searchParams;
  const active = isPlanActive(user.plan, user.planExpiresAt);
  const limits = limitsFor(user.plan, user.planExpiresAt);

  const [contacts, emailUsage, payments, confirmedPaymentCount, subscription] = await Promise.all([
    prisma.contact.count({ where: { userId: user.id, isDemo: false } }),
    getEmailQuotaUsage(user),
    prisma.payment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.payment.count({ where: { userId: user.id, status: "CONFIRMED" } }),
    prisma.billingSubscription.findFirst({
      where: { userId: user.id, status: { in: ["ACTIVE", "CHARGING", "PAST_DUE"] } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const sentThisMonth = emailUsage.used;
  const isFirstPayment = confirmedPaymentCount === 0;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900">Тариф и оплата</h1>
      <p className="mt-1 text-ink-500">Текущий доступ, использование лимитов и история платежей.</p>

      {query.payment === "return" && (
        <div className="mt-4 rounded-xl border border-mint-200 bg-mint-50 px-5 py-4 text-sm text-mint-800">
          <div className="font-semibold">Платёж обрабатывается</div>
          <p className="mt-1">После подтверждения банком тариф включится автоматически. Обычно это занимает меньше минуты.</p>
        </div>
      )}
      {query.payment === "failed" && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          <div className="font-semibold">Не удалось перейти к оплате</div>
          <p className="mt-1">Попробуйте ещё раз. Если ошибка повторится, сообщите поддержке код {query.code || "PAY-1002"}.</p>
        </div>
      )}

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
              <div className="metric-number mt-1 text-sm text-ink-500">
                {active ? "Действует" : "Действовал"} до {user.planExpiresAt.toLocaleDateString("ru-RU")}
              </div>
            )}
          </div>
          {user.plan === "TRIAL" && active && (
            <span className="rounded-full border border-mint-200 bg-mint-50 px-3 py-1 text-xs font-semibold text-mint-700">
              Без ограничения по времени
            </span>
          )}
        </div>
        {subscription && (
          <div className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${subscription.status === "PAST_DUE" ? "border-amber-200 bg-amber-50" : "border-mint-200 bg-mint-50"}`}>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {subscription.status === "PAST_DUE" ? "Автопродление требует внимания" : "Автопродление включено"}
              </div>
              <p className="metric-number mt-0.5 text-xs text-ink-600">
                {subscription.status === "PAST_DUE"
                  ? "Повторный платёж не подтверждён. Можно оплатить тариф вручную."
                  : subscription.nextChargeAt
                    ? `${PLANS[subscription.plan].name} · следующий платёж — ${subscription.nextChargeAt.toLocaleDateString("ru-RU")}`
                    : "Новый платёж сейчас обрабатывается"}
              </p>
            </div>
            <CancelAutoRenewalButton />
          </div>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Usage label="Контакты" used={contacts} max={active ? limits.maxContacts : null} />
          <Usage label="Писем в этом месяце" used={sentThisMonth} max={active ? limits.maxEmailsPerMonth : null} />
        </div>
      </div>

      <div className="mt-8">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold text-slate-900">Выберите рабочий объём</h2>
          <p className="mt-1 text-sm text-ink-500">Пробный тариф позволяет пройти весь путь на небольшой реальной кампании. Для регулярных рассылок выберите рабочий объём.</p>
        </div>
        {isFirstPayment && (
          <div className="mt-5 flex items-start gap-4 rounded-2xl border border-mint-200 bg-mint-50 px-5 py-4">
            <div className="metric-number flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-mint-200 bg-white text-sm font-bold text-mint-700">
              +15
            </div>
            <div>
              <div className="font-semibold text-slate-900">Первая оплата — 45 дней доступа</div>
              <p className="mt-1 text-sm leading-6 text-ink-600">
                Первые 30 дней — обычный оплаченный период. Ещё 15 дней добавляем на прогрев новых ящиков, поэтому следующий автоматический платёж будет через 45 дней. После него подписка продлевается каждые 30 дней.
              </p>
            </div>
          </div>
        )}
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          {PAID_PLAN_KEYS.map((planKey) => {
            const plan = PLANS[planKey];
            const recommended = planKey === "START";
            const current = active && user.plan === planKey;
            const switchingPlan = active && user.plan !== "TRIAL" && !current;
            return (
              <article
                key={planKey}
                className={`relative flex flex-col rounded-2xl border bg-white p-6 ${recommended ? "border-mint-400 shadow-[0_18px_45px_rgba(14,159,110,0.10)]" : "border-line"}`}
              >
                {recommended && (
                  <span className="absolute right-5 top-5 rounded-full bg-mint-100 px-2.5 py-1 text-[10px] font-semibold text-mint-700">Рекомендуем</span>
                )}
                <div className="text-sm font-semibold text-slate-900">{plan.name}</div>
                <div className="mt-4 flex items-end gap-1">
                  <span className="metric-number text-4xl font-bold tracking-tight text-slate-900">{plan.priceRub.toLocaleString("ru-RU")}</span>
                  <span className="mb-1 text-ink-500">₽/мес</span>
                </div>
                <ul className="mt-5 flex-1 space-y-2.5 text-sm leading-5 text-ink-700">
                  <li>
                    ✓ {pricingCopy.contactsPrefix} <span className="metric-number font-medium text-slate-900">{plan.maxContacts.toLocaleString("ru-RU")}</span> {pricingCopy.contactsSuffix}
                  </li>
                  <li>
                    ✓ {pricingCopy.uploadPrefix} <span className="metric-number font-medium text-slate-900">{UPLOAD_CONTACT_LIMITS[planKey].toLocaleString("ru-RU")}</span> {pricingCopy.uploadSuffix}
                  </li>
                  <li>
                    ✓ {pricingCopy.contactsPrefix} <span className="metric-number font-medium text-slate-900">{aiGenerationLimit(planKey).toLocaleString("ru-RU")}</span> {pricingCopy.emailsSuffix}
                  </li>
                  <li>✓ {pricingCopy.dialogs}</li>
                </ul>
                <form action={startPayment} className="mt-6">
                  <input type="hidden" name="plan" value={planKey} />
                  <label className="mb-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      name="autoRenew"
                      defaultChecked
                      className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
                    />
                    <span>
                      <span className="block text-xs font-semibold text-slate-900">Продлевать автоматически</span>
                      <span className="metric-number mt-0.5 block text-[11px] leading-4 text-ink-500">
                        Сейчас спишем {plan.priceRub.toLocaleString("ru-RU")} ₽. {switchingPlan
                          ? "Тариф изменится после оплаты, оставшиеся оплаченные дни сохранятся."
                          : current
                            ? "К текущему сроку добавятся 30 дней."
                            : isFirstPayment
                              ? "Следующее автоматическое списание — после первого периода доступа."
                              : "К текущему сроку добавятся 30 дней."} Далее — каждые 30 дней. Можно отключить в любой момент.
                      </span>
                    </span>
                  </label>
                  <button className={`w-full rounded-lg px-4 py-3 text-sm font-semibold ${recommended ? "brand-gradient text-white" : "border border-line text-slate-900 hover:border-mint-400"}`}>
                    {current
                      ? "Продлить тариф"
                      : switchingPlan
                        ? `Перейти на «${plan.name}»`
                        : `Оплатить ${plan.priceRub.toLocaleString("ru-RU")} ₽`}
                  </button>
                </form>
                <p className="mt-2 text-center text-[11px] text-ink-500">
                  Нажимая кнопку, вы подтверждаете ознакомление с <Link href="/offer" target="_blank" className="underline">офертой</Link>. Договор заключается после оплаты.
                </p>
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
                    <td className="metric-number px-4 py-3 text-ink-700">{payment.createdAt.toLocaleString("ru-RU")}</td>
                    <td className="px-4 py-3 text-slate-900">{PLANS[payment.plan].name}</td>
                    <td className="metric-number px-4 py-3 text-ink-700">{(payment.amount / 100).toLocaleString("ru-RU")} ₽</td>
                    <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-xs ${payment.status === "CONFIRMED" ? "bg-mint-100 text-mint-700" : payment.status === "PENDING" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600"}`}>{payment.status === "CONFIRMED" ? "Оплачен" : payment.status === "PENDING" ? "Ожидает оплаты" : "Ошибка"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      <div className="metric-number mt-1 font-semibold text-slate-900">{used.toLocaleString("ru-RU")} {max ? `/ ${max.toLocaleString("ru-RU")}` : "· доступ приостановлен"}</div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface"><div className={pct >= 90 ? "h-full bg-red-400" : "h-full brand-gradient"} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
