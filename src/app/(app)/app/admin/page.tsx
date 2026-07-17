import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PLANS, effectivePlan } from "@/lib/plans";
import { adminChangePlan, adminConfirmPayment, adminToggleSeed, adminResetWarmup } from "./actions";
import { CreateClientForm } from "./CreateClientForm";

const warmupStatusLabels: Record<string, string> = {
  sent: "отправлено",
  delivered: "доставлено",
  opened: "прочитано",
  replied: "отвечено",
  rescued_from_spam: "спасено из спама",
  failed: "ошибка",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; name?: string }>;
}) {
  await requireAdmin();
  const { email: prefillEmail, name: prefillName } = await searchParams;

  const [users, landingLeads, pendingPayments, totals] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { contacts: true, campaigns: true, leads: true } },
      },
    }),
    prisma.landingLead.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.payment.findMany({
      where: { status: "PENDING" },
      include: { user: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.$transaction([
      prisma.user.count(),
      prisma.message.count(),
      prisma.lead.count({ where: { qualification: "HOT" } }),
      prisma.landingLead.count(),
    ]),
  ]);
  const [totalUsers, totalMessages, totalHotLeads, totalLandingLeads] = totals;
  const userEmails = new Set(users.map((u) => u.email.toLowerCase()));

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
  const seedCount = fleetMailboxes.filter((m) => m.isSeed).length;

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
      <h2 id="create-client" className="mt-10 text-lg font-semibold text-slate-900">
        Создать кабинет клиента
      </h2>
      <div className="mt-3 rounded-xl border border-line bg-white p-5">
        <CreateClientForm defaultEmail={prefillEmail} defaultName={prefillName} />
      </div>

      {/* платежи, ожидающие подтверждения */}
      {pendingPayments.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold text-slate-900">
            Платежи в ожидании ({pendingPayments.length})
          </h2>
          <div className="mt-3 space-y-2">
            {pendingPayments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-sm">
                  <span className="font-medium text-slate-900">{p.user.email}</span>
                  <span className="text-ink-700"> · {PLANS[p.plan].name} · {(p.amount / 100).toLocaleString("ru-RU")} ₽ · {p.createdAt.toLocaleString("ru-RU")}</span>
                </div>
                <form action={adminConfirmPayment}>
                  <input type="hidden" name="paymentId" value={p.id} />
                  <button className="rounded-lg brand-gradient-vivid px-4 py-2 text-xs font-semibold text-white">
                    Подтвердить оплату
                  </button>
                </form>
              </div>
            ))}
          </div>
        </>
      )}

      {/* клиенты */}
      <h2 className="mt-10 text-lg font-semibold text-slate-900">Клиенты ({users.length})</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-ink-500">
            <tr>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Тариф</th>
              <th className="px-4 py-3 font-medium">До</th>
              <th className="px-4 py-3 font-medium">Контакты</th>
              <th className="px-4 py-3 font-medium">Кампании</th>
              <th className="px-4 py-3 font-medium">Лиды</th>
              <th className="px-4 py-3 font-medium">Сменить тариф</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const eff = effectivePlan(u.plan, u.planExpiresAt);
              return (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{u.email}</span>
                    {u.role === "ADMIN" && (
                      <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">ADMIN</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-0.5 text-xs ${eff === "TRIAL" ? "bg-surface text-ink-700" : "bg-mint-100 text-mint-700"}`}>
                      {PLANS[eff].name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-500">
                    {u.planExpiresAt ? u.planExpiresAt.toLocaleDateString("ru-RU") : "—"}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{u._count.contacts}</td>
                  <td className="px-4 py-3 text-ink-700">{u._count.campaigns}</td>
                  <td className="px-4 py-3 text-ink-700">{u._count.leads}</td>
                  <td className="px-4 py-3">
                    <form action={adminChangePlan} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <select name="plan" defaultValue={u.plan} className="input !w-28 !py-1 text-xs">
                        <option value="TRIAL">Демо</option>
                        <option value="START">Старт</option>
                        <option value="PRO">Про</option>
                      </select>
                      <button className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                        OK
                      </button>
                    </form>
                  </td>
                </tr>
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
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm">
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

      {/* флот прогрева: seed-ящики + все ящики клиентов (§5.6) */}
      <h2 className="mt-10 text-lg font-semibold text-slate-900">
        Флот прогрева ({fleetMailboxes.length} ящиков · seed: {seedCount})
      </h2>
      <p className="mt-1 text-sm text-ink-500">
        Прогрев — кросс-клиентская сеть: ящики всех клиентов + наши seed-ящики
        переписываются между собой. Пометь seed те ящики, что ты завёл сам для
        разнообразия пиров (на старте, пока клиентов мало).
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
        {fleetMailboxes.length === 0 ? (
          <div className="p-8 text-center text-ink-500">Пока нет подключённых ящиков.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">Ящик</th>
                <th className="px-4 py-3 font-medium">Владелец</th>
                <th className="px-4 py-3 font-medium">Прогрев</th>
                <th className="px-4 py-3 font-medium">Отправлено</th>
                <th className="px-4 py-3 font-medium">Подключение</th>
                <th className="px-4 py-3 font-medium">Seed</th>
                <th className="px-4 py-3 font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {fleetMailboxes.map((m) => (
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
                    <form action={adminToggleSeed}>
                      <input type="hidden" name="mailboxId" value={m.id} />
                      <input type="hidden" name="makeSeed" value={m.isSeed ? "0" : "1"} />
                      <button
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                          m.isSeed
                            ? "bg-mint-100 text-mint-700"
                            : "border border-line text-ink-500 hover:text-slate-900"
                        }`}
                      >
                        {m.isSeed ? "✓ seed" : "Сделать seed"}
                      </button>
                    </form>
                  </td>
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
          <table className="w-full text-left text-sm">
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
      <div className="mt-10 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Заявки с лендинга</h2>
        <a
          href="/api/leads/export"
          className="rounded-lg brand-gradient-vivid px-4 py-2 text-sm font-semibold text-white glow"
        >
          Экспорт в Excel
        </a>
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-white">
        {landingLeads.length === 0 ? (
          <div className="p-8 text-center text-ink-500">Пока нет заявок.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">Дата</th>
                <th className="px-4 py-3 font-medium">Имя</th>
                <th className="px-4 py-3 font-medium">Компания</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Telegram</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {landingLeads.map((l) => {
                const hasAccount = userEmails.has(l.email.toLowerCase());
                return (
                  <tr key={l.id} className="border-t border-line">
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
                      ) : (
                        <a
                          href={`/app/admin?email=${encodeURIComponent(l.email)}&name=${encodeURIComponent(l.name)}#create-client`}
                          className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700"
                        >
                          Создать кабинет
                        </a>
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
