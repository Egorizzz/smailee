import { Fragment } from "react";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PLANS, isPlanActive, planDisplayName } from "@/lib/plans";
import { expectedPaidPlanExpiry, paidPeriodDurationDays } from "@/lib/billingPeriods";
import { adminChangePlan, adminRepairPlanExpiry, adminResetWarmup } from "./actions";
import { CreateClientForm } from "./CreateClientForm";
import { SeedMailboxForm } from "./SeedMailboxForm";
import { config } from "@/lib/config";
import { AdminTelegramControl } from "@/components/AdminTelegramControl";
import { expirePendingPayments } from "@/server/billing";

const warmupStatusLabels: Record<string, string> = {
  sent: "отправлено",
  delivered: "доставлено",
  opened: "прочитано",
  replied: "отвечено",
  rescued_from_spam: "спасено из спама",
  failed: "ошибка",
};

const paymentKindLabels: Record<string, string> = {
  ONE_TIME: "Разовая оплата",
  SUBSCRIPTION_INITIAL: "Первая оплата подписки",
  SUBSCRIPTION_RENEWAL: "Автопродление",
  MANUAL: "Ручная оплата",
};

const paymentStatusMeta: Record<string, { label: string; className: string }> = {
  CONFIRMED: { label: "Подтверждён", className: "bg-mint-100 text-mint-700" },
  PENDING: { label: "Ожидает", className: "bg-amber-100 text-amber-800" },
  FAILED: { label: "Не прошёл", className: "bg-red-50 text-red-700" },
  EXPIRED: { label: "Истёк", className: "bg-surface text-ink-600" },
};

function formatAdminDate(value: Date | null) {
  return value?.toLocaleDateString("ru-RU") ?? "—";
}

function formatAdminDateTime(value: Date | null) {
  return value?.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) ?? "—";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; name?: string; company?: string; payments?: string }>;
}) {
  await requireAdmin();
  await expirePendingPayments();
  const {
    email: prefillEmail,
    name: prefillName,
    company: prefillCompany,
    payments: expandedPaymentsUserId,
  } = await searchParams;

  const [users, landingLeads, pendingPayments, totals, adminTelegramRecipients] = await Promise.all([
    prisma.user.findMany({
      where: { role: "CLIENT", ownedOrganization: { isNot: null } },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { contacts: true, campaigns: true, leads: true } },
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            amount: true,
            plan: true,
            status: true,
            kind: true,
            changeType: true,
            activationMode: true,
            entitlementEndsAt: true,
            createdAt: true,
            confirmedAt: true,
          },
        },
      },
    }),
    prisma.landingLead.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.payment.findMany({
      where: { status: "PENDING" },
      include: { user: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.$transaction([
      prisma.user.count({ where: { role: "CLIENT", ownedOrganization: { isNot: null } } }),
      prisma.message.count(),
      prisma.lead.count({ where: { qualification: "HOT" } }),
      prisma.landingLead.count(),
    ]),
    prisma.adminTelegramRecipient.findMany({
      where: { revokedAt: null },
      orderBy: { connectedAt: "desc" },
      select: {
        id: true,
        telegramUsername: true,
        telegramName: true,
        connectedAt: true,
      },
    }),
  ]);
  const [totalUsers, totalMessages, totalHotLeads, totalLandingLeads] = totals;
  const userEmails = new Set(users.map((u) => u.email.toLowerCase()));
  const emailSuggestions = landingLeads
    .filter((lead) => lead.email && !userEmails.has(lead.email.toLowerCase()))
    .slice(0, 12)
    .map((lead) => ({
      email: lead.email,
      label: [lead.name, lead.company, lead.email].filter(Boolean).join(" · "),
      name: lead.name,
      company: lead.company ?? "",
    }));

  // Флот прогрева (§5.6): все ящики всех клиентов — кросс-клиентская сеть,
  // поэтому админ видит их целиком (не по одному кабинету).
  const [fleetMailboxes, recentWarmup, setupRequests] = await Promise.all([
    prisma.mailbox.findMany({
      orderBy: [{ isSeed: "desc" }, { email: "asc" }],
      include: {
        user: { select: { email: true } },
        // реально отправлено прогревом за всё время — видно, набрался ли
        // порог для честного перехода в "warm" (см. warmupEngine.ts)
        _count: { select: { warmupSent: { where: { status: { not: "failed" } } } } },
      },
    }),
    prisma.warmupEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        senderMailbox: { select: { email: true } },
        recipientMailbox: { select: { email: true } },
      },
    }),
    prisma.setupRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { user: { select: { email: true } } },
    }),
  ]);
  const seedMailboxes = fleetMailboxes.filter((mailbox) => mailbox.isSeed);
  const clientMailboxes = fleetMailboxes.filter((mailbox) => !mailbox.isSeed);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold text-slate-900">Админка</h1>
      <p className="mt-1 text-ink-500">Клиенты, тарифы, платежи и заявки с лендинга.</p>

      {/* сводка */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { l: "Клиентов", v: totalUsers },
          { l: "Писем отправлено", v: totalMessages },
          { l: "Тёплых лидов", v: totalHotLeads },
          { l: "Заявок с лендинга", v: totalLandingLeads },
        ].map((s) => (
          <div key={s.l} className="rounded-xl border border-line bg-white p-4">
            <div className="text-2xl font-bold text-slate-900">{s.v}</div>
            <div className="text-sm text-ink-500">{s.l}</div>
          </div>
        ))}
      </div>

      {/* создать клиента */}
      <AdminTelegramControl
        configured={Boolean(config.adminTelegram.botToken)}
        recipients={adminTelegramRecipients.map((recipient) => ({
          ...recipient,
          connectedAt: recipient.connectedAt.toISOString(),
        }))}
      />

      <h2 id="create-client" className="mt-10 text-lg font-semibold text-slate-900">
        Создать кабинет клиента
      </h2>
      <div className="mt-3 rounded-xl border border-line bg-white p-5">
        <CreateClientForm defaultEmail={prefillEmail} defaultName={prefillName} defaultCompany={prefillCompany} emailSuggestions={emailSuggestions} />
      </div>

      {/* платежи, ожидающие подтверждения */}
      {pendingPayments.length > 0 && (
        <details className="group mt-10 overflow-hidden rounded-xl border border-line bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-slate-900">
            <span>Платежи в ожидании <span className="metric-number">({pendingPayments.length})</span></span>
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </summary>
          <div className="space-y-2 border-t border-line bg-surface/50 p-3">
            {pendingPayments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-sm">
                  <span className="font-medium text-slate-900">{p.user.email}</span>
                  <span className="text-ink-700"> · {PLANS[p.plan].name} · {(p.amount / 100).toLocaleString("ru-RU")} ₽ · {p.createdAt.toLocaleString("ru-RU")}</span>
                </div>
                <span className="metric-number text-xs text-amber-800">Ссылка действует до {formatAdminDateTime(p.expiresAt)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* клиенты */}
      <h2 className="mt-10 text-lg font-semibold text-slate-900">
        Клиенты <span className="metric-number">({users.length})</span>
      </h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-surface text-ink-500">
            <tr>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Тариф</th>
              <th className="px-4 py-3 font-medium">До</th>
              <th className="px-4 py-3 font-medium">Контакты</th>
              <th className="px-4 py-3 font-medium">Кампании</th>
              <th className="px-4 py-3 font-medium">Лиды</th>
              <th className="px-4 py-3 font-medium">Оплаты</th>
              <th className="px-4 py-3 font-medium">Выдать доступ</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const active = isPlanActive(u.plan, u.planExpiresAt);
              const expanded = expandedPaymentsUserId === u.id;
              const hasPendingPayment = u.payments.some((payment) => payment.status === "PENDING");
              const confirmedPayments = u.payments.filter((payment) => payment.status === "CONFIRMED");
              const confirmedTotal = confirmedPayments.reduce((sum, payment) => sum + payment.amount, 0);
              const expectedExpiry = expectedPaidPlanExpiry(u.payments);
              const latestConfirmedPayment = [...confirmedPayments]
                .sort((left, right) => (right.confirmedAt?.getTime() ?? 0) - (left.confirmedAt?.getTime() ?? 0))[0];
              const expiryMismatch = Boolean(
                expectedExpiry
                && u.planExpiresAt
                && !u.scheduledPlan
                && latestConfirmedPayment?.plan === u.plan
                && Math.abs(expectedExpiry.getTime() - u.planExpiresAt.getTime()) > 12 * 60 * 60 * 1000,
              );
              const preservedParams = new URLSearchParams();
              if (prefillEmail) preservedParams.set("email", prefillEmail);
              if (prefillName) preservedParams.set("name", prefillName);
              if (prefillCompany) preservedParams.set("company", prefillCompany);
              if (!expanded) preservedParams.set("payments", u.id);
              const paymentHistoryHref = `/app/admin${preservedParams.size ? `?${preservedParams.toString()}` : ""}#client-${u.id}`;

              return (
                <Fragment key={u.id}>
                  <tr id={`client-${u.id}`} className={`scroll-mt-6 border-t border-line ${expanded ? "bg-[#fbfdfc]" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-900">{u.emailPending ? "Не добавлен" : u.email}</span>
                      {u.emailPending && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">email не добавлен</span>
                      )}
                      {u.role === "ADMIN" && (
                        <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">ADMIN</span>
                      )}
                      {u.mustChangePassword && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">временный пароль</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs ${!active ? "bg-amber-50 text-amber-800" : u.isDemo ? "bg-indigo-50 text-indigo-700" : "bg-mint-100 text-mint-700"}`}>
                        {planDisplayName(u)}
                      </span>
                      <div className="mt-1 text-[11px] text-ink-500">
                        {u.planSource === "PAYMENT" ? "Оплачен" : u.planSource === "ADMIN" ? "Выдан вручную" : "Пробный доступ"}
                      </div>
                    </td>
                    <td className="metric-number px-4 py-3 text-ink-500">
                      {formatAdminDate(u.planExpiresAt)}
                    </td>
                    <td className="metric-number px-4 py-3 text-ink-700">{u._count.contacts}</td>
                    <td className="metric-number px-4 py-3 text-ink-700">{u._count.campaigns}</td>
                    <td className="metric-number px-4 py-3 text-ink-700">{u._count.leads}</td>
                    <td className="px-4 py-3">
                      <a
                        href={paymentHistoryHref}
                        aria-expanded={expanded}
                        className={`inline-flex min-w-28 items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-left transition-colors ${expanded ? "border-slate-300 bg-slate-900 text-white" : "border-line bg-white text-slate-900 hover:bg-surface"}`}
                      >
                        <span>
                          <span className="metric-number block text-sm font-semibold">
                            {confirmedPayments.length > 0 ? confirmedPayments.length : u.payments.length}
                          </span>
                          <span className={`block text-[11px] ${expanded ? "text-slate-300" : "text-ink-500"}`}>
                            {confirmedPayments.length > 0
                              ? `${(confirmedTotal / 100).toLocaleString("ru-RU")} ₽`
                              : u.payments.length > 0 ? "без подтверждения" : "оплат нет"}
                          </span>
                        </span>
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        >
                          <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      {hasPendingPayment ? (
                        <span className="inline-flex max-w-44 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-4 text-amber-800">
                          Сначала обработайте ожидающую оплату
                        </span>
                      ) : (
                        <form action={adminChangePlan} className="flex items-center gap-2">
                          <input type="hidden" name="userId" value={u.id} />
                          <select name="plan" defaultValue={u.plan} className="input !w-36 !py-1 text-xs">
                            <option value="TRIAL">Приостановлен</option>
                            <option value="BASIC">Базовый</option>
                            <option value="START">Стандартный</option>
                            <option value="PRO">Про</option>
                          </select>
                          <button className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                            Выдать
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-t border-line bg-[#f7faf9]">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="overflow-hidden rounded-xl border border-line bg-white shadow-[0_2px_3px_-2px_rgba(28,40,64,0.10),0_4px_6px_-2px_rgba(28,40,64,0.04)]">
                          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4">
                            <div>
                              <div className="font-semibold text-slate-900">История оплат и продлений</div>
                              <div className="mt-1 text-xs text-ink-500">
                                Платежи клиента и срок, который должен получиться по подтверждённым операциям.
                              </div>
                            </div>
                            <div className="text-right text-xs text-ink-500">
                              Текущий доступ до
                              <div className="metric-number mt-0.5 text-sm font-semibold text-slate-900">
                                {formatAdminDate(u.planExpiresAt)}
                              </div>
                            </div>
                          </div>

                          {expiryMismatch && expectedExpiry && u.planExpiresAt && (
                            <div className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                              <div>
                                <div>Срок тарифа не сходится с историей подтверждённых платежей.</div>
                                <div className="metric-number mt-0.5 font-semibold">
                                  Ожидается до {formatAdminDate(expectedExpiry)} · сохранено до {formatAdminDate(u.planExpiresAt)}
                                </div>
                              </div>
                              <form action={adminRepairPlanExpiry}>
                                <input type="hidden" name="userId" value={u.id} />
                                <button className="rounded-[10px] border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                                  Исправить срок
                                </button>
                              </form>
                            </div>
                          )}

                          {u.payments.length === 0 ? (
                            <div className="px-4 py-8 text-center text-sm text-ink-500">
                              Оплат ещё не было. Текущий доступ установлен без платёжной операции.
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[880px] text-left text-sm">
                                <thead className="bg-surface text-xs text-ink-500">
                                  <tr>
                                    <th className="px-4 py-3 font-medium">Операция</th>
                                    <th className="px-4 py-3 font-medium">Тариф</th>
                                    <th className="px-4 py-3 text-right font-medium">Сумма</th>
                                    <th className="px-4 py-3 font-medium">Создана</th>
                                    <th className="px-4 py-3 font-medium">Подтверждена</th>
                                    <th className="px-4 py-3 font-medium">Статус</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {u.payments.map((payment) => {
                                    const status = paymentStatusMeta[payment.status] ?? {
                                      label: payment.status,
                                      className: "bg-surface text-ink-700",
                                    };
                                    const confirmedIndex = [...confirmedPayments]
                                      .sort((left, right) => (left.confirmedAt?.getTime() ?? 0) - (right.confirmedAt?.getTime() ?? 0))
                                      .findIndex((item) => item.id === payment.id);
                                    const durationDays = payment.status === "CONFIRMED"
                                      ? paidPeriodDurationDays(
                                          confirmedIndex,
                                          payment.confirmedAt!,
                                          payment.changeType,
                                        )
                                      : null;
                                    const durationLabel = durationDays === null
                                      ? null
                                      : payment.activationMode === "NEXT_PERIOD" && payment.entitlementEndsAt
                                        ? `С ${payment.entitlementEndsAt.toLocaleDateString("ru-RU")} · ${durationDays} дней`
                                        : payment.activationMode === "IMMEDIATE"
                                          ? `Сразу · ${durationDays} дней`
                                          : `+${durationDays} дней`;
                                    const operationLabel = payment.changeType === "UPGRADE"
                                      ? "Апгрейд тарифа"
                                      : payment.changeType === "DOWNGRADE"
                                        ? "Переход на младший тариф"
                                        : payment.kind === "SUBSCRIPTION_INITIAL" && confirmedIndex > 0
                                          ? "Продление подписки"
                                          : paymentKindLabels[payment.kind] ?? "Оплата";

                                    return (
                                      <tr key={payment.id} className="border-t border-line first:border-t-0">
                                        <td className="px-4 py-3">
                                          <div className="font-medium text-slate-900">
                                            {operationLabel}
                                          </div>
                                          {durationLabel && (
                                            <div className="metric-number mt-0.5 text-xs text-ink-500">{durationLabel}</div>
                                          )}
                                        </td>
                                        <td className="px-4 py-3 text-ink-700">{PLANS[payment.plan].name}</td>
                                        <td className="metric-number px-4 py-3 text-right font-semibold text-slate-900">
                                          {(payment.amount / 100).toLocaleString("ru-RU")} ₽
                                        </td>
                                        <td className="metric-number px-4 py-3 text-ink-500">
                                          {formatAdminDateTime(payment.createdAt)}
                                        </td>
                                        <td className="metric-number px-4 py-3 text-ink-500">
                                          {formatAdminDateTime(payment.confirmedAt)}
                                        </td>
                                        <td className="px-4 py-3">
                                          <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${status.className}`}>
                                            {status.label}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* заявки «Настройте всё за меня» (онбординг-визард, R2) */}
      {setupRequests.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold text-slate-900">
            Заявки на настройку ({setupRequests.length})
          </h2>
          <div className="mt-3 space-y-2">
            {setupRequests.map((r) => (
              <div id={`setup-request-${r.id}`} key={r.id} className="scroll-mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm">
                <div>
                  <span className="font-medium text-slate-900">{r.name}</span>
                  <span className="text-ink-700"> · {r.contact}</span>
                  {r.preferredTime && <span className="text-ink-500"> · удобно: {r.preferredTime}</span>}
                </div>
                <div className="text-xs text-ink-500">
                  кабинет {r.user.email} · {r.createdAt.toLocaleString("ru-RU")}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="mt-10 text-lg font-semibold text-slate-900">
        Служебные seed-ящики <span className="metric-number">({seedMailboxes.length})</span>
      </h2>
      <p className="mt-1 text-sm text-ink-500">
        Отдельные прогретые ящики Smailee: принимают прогревочные письма и помогают клиентским
        ящикам, но не участвуют в кампаниях. Повторное подключение того же email обновит доступы.
      </p>
      <SeedMailboxForm />
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
        {seedMailboxes.length === 0 ? (
          <div className="p-8 text-center text-ink-500">Служебные seed-ящики пока не подключены.</div>
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">Ящик</th>
                <th className="px-4 py-3 font-medium">Владелец</th>
                <th className="px-4 py-3 font-medium">Подключение</th>
                <th className="px-4 py-3 font-medium">Ответов отправлено</th>
              </tr>
            </thead>
            <tbody>
              {seedMailboxes.map((mailbox) => (
                <tr key={mailbox.id} className="border-t border-line">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{mailbox.email}</div>
                    {mailbox.connError && (
                      <div className="mt-0.5 text-xs text-red-600">{mailbox.connError}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{mailbox.user.email}</td>
                  <td className="px-4 py-3 text-ink-700">{mailbox.connState}</td>
                  <td className="metric-number px-4 py-3 text-ink-700">{mailbox._count.warmupSent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* клиентский флот прогрева (§5.6) */}
      <h2 className="mt-10 text-lg font-semibold text-slate-900">
        Клиентские ящики <span className="metric-number">({clientMailboxes.length})</span>
      </h2>
      <p className="mt-1 text-sm text-ink-500">
        Эти ящики автоматически прогреваются между собой и со служебными seed-ящиками.
        Переводить клиентские ящики в seed не требуется.
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
        {clientMailboxes.length === 0 ? (
          <div className="p-8 text-center text-ink-500">Пока нет подключённых ящиков.</div>
        ) : (
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="bg-surface text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">Ящик</th>
                <th className="px-4 py-3 font-medium">Владелец</th>
                <th className="px-4 py-3 font-medium">Прогрев</th>
                <th className="px-4 py-3 font-medium">Отправлено</th>
                <th className="px-4 py-3 font-medium">Подключение</th>
                <th className="px-4 py-3 font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {clientMailboxes.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium text-slate-900">{m.email}</td>
                  <td className="px-4 py-3 text-ink-700">{m.user.email}</td>
                  <td className="px-4 py-3 text-ink-700">
                    {m.warmupState}
                    {m.warmupState === "warming" ? ` · день ${m.warmupDay}` : ""}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{m._count.warmupSent}</td>
                  <td className="px-4 py-3 text-ink-700">{m.connState}</td>
                  <td className="px-4 py-3">
                    {m.warmupState !== "off" && (
                      <form action={adminResetWarmup}>
                        <input type="hidden" name="mailboxId" value={m.id} />
                        <button
                          className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-500 hover:border-red-300 hover:text-red-600"
                          title="Сбросить прогрев на ноль — честно перепройти ramp с нуля"
                        >
                          Сбросить прогрев
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* последние события прогрева (отладка сети, §4.4) */}
      <h2 className="mt-10 text-lg font-semibold text-slate-900">Последние события прогрева</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
        {recentWarmup.length === 0 ? (
          <div className="p-8 text-center text-ink-500">
            Пока нет прогревочного трафика. Запусти воркер (<code>npm run worker</code>) при
            ≥2 подключённых ящиках (или ящик + seed) — прогрев стартует автоматически.
          </div>
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">Время</th>
                <th className="px-4 py-3 font-medium">От</th>
                <th className="px-4 py-3 font-medium">Кому</th>
                <th className="px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3 font-medium">Ход</th>
              </tr>
            </thead>
            <tbody>
              {recentWarmup.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-4 py-3 text-ink-500">{e.createdAt.toLocaleString("ru-RU")}</td>
                  <td className="px-4 py-3 text-ink-700">{e.senderMailbox.email}</td>
                  <td className="px-4 py-3 text-ink-700">{e.recipientMailbox.email}</td>
                  <td className="px-4 py-3 text-ink-700">{warmupStatusLabels[e.status] ?? e.status}</td>
                  <td className="px-4 py-3 text-ink-500">{e.hop === 0 ? "открытие" : `ответ ${e.hop}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* заявки с лендинга */}
      <div className="mt-10 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <h2 className="text-lg font-semibold text-slate-900">Заявки с лендинга</h2>
        <a
          href="/api/leads/export"
          className="rounded-lg brand-gradient-vivid px-4 py-2 text-sm font-semibold text-white glow"
        >
          Экспорт в Excel
        </a>
      </div>
      {/* overflow-x-auto, а не overflow-hidden: иначе на узком экране колонки
          таблицы просто обрезаются и до них не добраться */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
        {landingLeads.length === 0 ? (
          <div className="p-8 text-center text-ink-500">Пока нет заявок.</div>
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">Дата</th>
                <th className="px-4 py-3 font-medium">Имя</th>
                <th className="px-4 py-3 font-medium">Компания</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Другой контакт</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {landingLeads.map((l) => {
                const hasAccount = Boolean(l.email) && userEmails.has(l.email.toLowerCase());
                return (
                  <tr id={`landing-lead-${l.id}`} key={l.id} className="scroll-mt-6 border-t border-line">
                    <td className="px-4 py-3 text-ink-500">{l.createdAt.toLocaleString("ru-RU")}</td>
                    <td className="px-4 py-3 text-slate-900">{l.name}</td>
                    <td className="px-4 py-3 text-ink-700">{l.company ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-700">{l.email}</td>
                    <td className="px-4 py-3 text-ink-700">{l.messenger ?? "—"}</td>
                    <td className="px-4 py-3">
                      {hasAccount ? (
                        <span className="rounded-full bg-mint-100 px-2 py-0.5 text-xs font-semibold text-mint-700">
                          Кабинет есть
                        </span>
                      ) : l.email ? (
                        <a
                          href={`/app/admin?email=${encodeURIComponent(l.email)}&name=${encodeURIComponent(l.name)}&company=${encodeURIComponent(l.company || "")}#create-client`}
                          className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700"
                        >
                          Создать кабинет
                        </a>
                      ) : (
                        <span className="text-xs text-ink-500">Нет email</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
