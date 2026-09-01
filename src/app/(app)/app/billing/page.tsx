import Link from "next/link";
import { requireCapability } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { PAID_PLAN_KEYS, PLANS, UPLOAD_CONTACT_LIMITS, aiGenerationLimit, isPlanActive, limitsFor, planDisplayName } from "@/lib/plans";
import { startPayment } from "./actions";
import { getEmailQuotaUsage } from "@/server/limits";
import { CancelAutoRenewalButton } from "@/components/CancelAutoRenewalButton";
import { pricingCopy } from "@/content/landing/pricing";
import { PaymentReturnNotice } from "@/components/PaymentReturnNotice";
import { applyDuePlanTransitions, expirePendingPayments } from "@/server/billing";

type BillingSearchParams = Promise<{ payment?: string; code?: string; id?: string; source?: string }>;

export default async function BillingPage({ searchParams }: { searchParams: BillingSearchParams }) {
  const { owner: sessionUser } = await requireCapability("BILLING_MANAGE");
  const query = await searchParams;
  await Promise.all([expirePendingPayments(), applyDuePlanTransitions()]);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: sessionUser.id } });
  const now = new Date();
  const active = isPlanActive(user.plan, user.planExpiresAt);
  const hasCurrentPaidAccess = active
    && user.plan !== "TRIAL"
    && Boolean(user.planExpiresAt && user.planExpiresAt > now);
  const hasPrepaidPeriod = Boolean(
    user.scheduledPlan
    && user.scheduledPlanAt
    && user.scheduledPlanExpiresAt
    && user.scheduledPlanExpiresAt > now,
  );
  const limits = limitsFor(user.plan, user.planExpiresAt);

  const [contacts, emailUsage, payments, confirmedPaymentCount, subscription, returnPayment] = await Promise.all([
    prisma.contact.count({ where: { userId: user.id, isDemo: false } }),
    getEmailQuotaUsage(user),
    prisma.payment.findMany({
      where: { userId: user.id, status: "CONFIRMED" },
      orderBy: { confirmedAt: "desc" },
      take: 10,
    }),
    prisma.payment.count({ where: { userId: user.id, status: "CONFIRMED" } }),
    prisma.billingSubscription.findFirst({
      where: { userId: user.id, status: { in: ["ACTIVE", "CHARGING", "PAST_DUE"] } },
      orderBy: { createdAt: "desc" },
    }),
    query.payment === "return" && query.id
      ? prisma.payment.findFirst({
          where: { id: query.id, userId: user.id },
          select: { status: true },
        })
      : null,
  ]);
  const sentThisMonth = emailUsage.used;
  const getsFirstPaymentBonus = confirmedPaymentCount === 0 && !hasCurrentPaidAccess;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900">Тариф и оплата</h1>
      <p className="mt-1 text-ink-500">Текущий доступ, использование лимитов и история платежей.</p>

      {query.payment === "return" && (
        <PaymentReturnNotice status={returnPayment?.status ?? "NOT_FOUND"} />
      )}
      {query.payment === "failed" && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          <div className="font-semibold">Не удалось перейти к оплате</div>
          <p className="mt-1">
            {query.code === "PAY-1004"
              ? "Следующий период уже оплачен. Новый тариф можно выбрать после его начала."
              : <>Попробуйте ещё раз. Если ошибка повторится, сообщите поддержке код {query.code || "PAY-1002"}.</>}
          </p>
        </div>
      )}
      {query.source === "onboarding" && user.plan === "TRIAL" && (
        <div className="mt-4 rounded-xl border border-mint-200 bg-mint-50 px-5 py-4 text-sm text-mint-900">
          <div className="font-semibold">Первый путь пройден — выберите объём для рабочей кампании</div>
          <p className="mt-1 text-mint-800">Для первого запуска рекомендуем «Базовый». Оплата начнётся только после выбора тарифа и подтверждения в банке.</p>
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
            {user.scheduledPlan && user.scheduledPlanAt && (
              <div className="mt-2 text-sm text-ink-600">
                Оплачен следующий период: «{PLANS[user.scheduledPlan].name}» с <span className="metric-number">{user.scheduledPlanAt.toLocaleDateString("ru-RU")}</span>
                {user.scheduledPlanExpiresAt && <> до <span className="metric-number">{user.scheduledPlanExpiresAt.toLocaleDateString("ru-RU")}</span></>}
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
        {getsFirstPaymentBonus && (
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
        <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {PAID_PLAN_KEYS.map((planKey) => {
            const plan = PLANS[planKey];
            const recommended = getsFirstPaymentBonus ? planKey === "BASIC" : planKey === "START";
            const current = active && user.plan === planKey;
            const switchingPlan = hasCurrentPaidAccess && !current;
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
                  {hasCurrentPaidAccess && user.planExpiresAt && (
                      <ActivationOptions
                        amount={plan.priceRub}
                        currentEndsAt={user.planExpiresAt}
                        fieldId={`activation-${planKey.toLowerCase()}`}
                        targetPlanName={plan.name}
                        samePlan={current}
                      />
                    )}
                    <label className="mb-3 mt-3 flex cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-3 text-left">
                      <input
                        type="checkbox"
                        name="autoRenew"
                        defaultChecked
                        className="h-4 w-4 shrink-0 accent-emerald-600"
                      />
                      <span className="text-xs font-semibold text-slate-900">Продлевать автоматически</span>
                    </label>
                  <button disabled={hasPrepaidPeriod} className={`w-full rounded-lg px-4 py-3 text-sm font-semibold disabled:cursor-default disabled:opacity-60 ${recommended ? "brand-gradient text-white" : "border border-line text-slate-900 hover:border-mint-400"}`}>
                    {hasPrepaidPeriod
                      ? "Следующий период уже оплачен"
                      : current
                      ? "Оплатить новый период"
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
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-semibold text-slate-900">Подтверждённые оплаты</h2>
          </div>
          <div className="scroll-x">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-surface text-ink-500"><tr><th className="px-4 py-3 font-medium">Дата</th><th className="px-4 py-3 font-medium">План</th><th className="px-4 py-3 font-medium">Сумма</th><th className="px-4 py-3 font-medium">Статус</th></tr></thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-line">
                    <td className="metric-number px-4 py-3 text-ink-700">{payment.createdAt.toLocaleString("ru-RU")}</td>
                    <td className="px-4 py-3 text-slate-900">{PLANS[payment.plan].name}</td>
                    <td className="metric-number px-4 py-3 text-ink-700">{(payment.amount / 100).toLocaleString("ru-RU")} ₽</td>
                    <td className="px-4 py-3"><span className="rounded-md bg-mint-100 px-2 py-0.5 text-xs text-mint-700">Оплачен</span></td>
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

function ActivationOptions({
  amount,
  currentEndsAt,
  fieldId,
  targetPlanName,
  samePlan,
}: {
  amount: number;
  currentEndsAt: Date;
  fieldId: string;
  targetPlanName: string;
  samePlan: boolean;
}) {
  const formattedAmount = amount.toLocaleString("ru-RU");
  const formattedDate = currentEndsAt.toLocaleDateString("ru-RU");
  const tooltipId = `${fieldId}-help`;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={fieldId} className="text-xs font-semibold text-slate-900">
          Когда применить
        </label>
        <span className="group relative">
          <button
            type="button"
            aria-describedby={tooltipId}
            aria-label="Подробнее о вариантах перехода"
            className="flex h-5 w-5 items-center justify-center rounded-full border border-line bg-white text-[11px] font-semibold text-ink-500 transition hover:border-mint-500 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-400"
          >
            i
          </button>
          <span
            id={tooltipId}
            role="tooltip"
            className="invisible pointer-events-none absolute right-0 top-full z-30 mt-2 w-72 rounded-lg bg-slate-950 px-3.5 py-3 text-left text-xs font-normal leading-5 text-white opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
          >
            <span className="block font-semibold">Сразу</span>
            <span className="block text-slate-300">
              Спишем <span className="metric-number">{formattedAmount} ₽</span>. {samePlan ? "Лимиты обновятся" : `Тариф «${targetPlanName}» и лимиты обновятся`} после оплаты, начнётся новый период на <span className="metric-number">30</span> дней. Остаток текущего периода не переносится.
            </span>
            <span className="mt-2 block font-semibold">После текущего периода</span>
            <span className="block text-slate-300">
              Спишем <span className="metric-number">{formattedAmount} ₽</span> сейчас. Текущие условия сохранятся до <span className="metric-number">{formattedDate}</span>, затем начнётся оплаченный период «{targetPlanName}» на <span className="metric-number">30</span> дней.
            </span>
          </span>
        </span>
      </div>
      <span className="relative block">
        <select
          id={fieldId}
          name="activationMode"
          defaultValue="IMMEDIATE"
          className="w-full appearance-none rounded-lg border border-line bg-white px-3 py-3 pr-10 text-xs font-semibold text-slate-900 outline-none transition hover:border-mint-400 focus:border-mint-500 focus:ring-2 focus:ring-mint-200"
        >
          <option value="IMMEDIATE">{samePlan ? "Новый период сразу" : "Перейти сразу"}</option>
          <option value="NEXT_PERIOD">После текущего периода</option>
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
        >
          <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
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
