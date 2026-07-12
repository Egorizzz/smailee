import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PLANS, effectivePlan, limitsFor } from "@/lib/plans";
import { startPayment } from "./actions";

export default async function BillingPage() {
  const user = await requireUser();
  const eff = effectivePlan(user.plan, user.planExpiresAt);
  const limits = limitsFor(user.plan, user.planExpiresAt);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [contacts, sentThisMonth, payments] = await Promise.all([
    prisma.contact.count({ where: { userId: user.id } }),
    prisma.message.count({
      where: { campaign: { userId: user.id }, createdAt: { gte: monthStart } },
    }),
    prisma.payment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const expired = user.plan !== "TRIAL" && eff === "TRIAL";

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900">Тариф и оплата</h1>
      <p className="mt-1 text-ink-500">
        Текущий план, использование лимитов и история платежей.
      </p>

      {expired && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          Срок действия тарифа «{PLANS[user.plan].name}» истёк — действуют лимиты
          пробного плана. Оплатите продление ниже.
        </div>
      )}

      {/* текущий план и использование */}
      <div className="mt-6 rounded-2xl border border-line bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-ink-500">Текущий тариф</div>
            <div className="text-xl font-bold text-slate-900">
              {PLANS[eff].name}
              {user.planExpiresAt && eff !== "TRIAL" && (
                <span className="ml-2 text-sm font-normal text-ink-500">
                  до {user.planExpiresAt.toLocaleDateString("ru-RU")}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Usage label="Контакты" used={contacts} max={limits.maxContacts} />
          <Usage label="Писем в этом месяце" used={sentThisMonth} max={limits.maxEmailsPerMonth} />
        </div>
      </div>

      {/* тарифы */}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {(["START", "PRO"] as const).map((p) => (
          <div key={p} className={`rounded-2xl border bg-white p-6 ${eff === p ? "border-mint-400" : "border-line"}`}>
            <div className="text-sm font-semibold uppercase tracking-wide text-mint-700">
              {PLANS[p].name}
            </div>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-4xl font-bold text-slate-900">
                {PLANS[p].priceRub.toLocaleString("ru-RU")}
              </span>
              <span className="mb-1 text-ink-500">₽/мес</span>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-ink-700">
              <li>✓ До {PLANS[p].maxContacts.toLocaleString("ru-RU")} контактов</li>
              <li>✓ До {PLANS[p].maxEmailsPerMonth.toLocaleString("ru-RU")} писем/мес</li>
              <li>✓ AI-письма, диалог, квалификация лидов</li>
            </ul>
            <form action={startPayment} className="mt-5">
              <input type="hidden" name="plan" value={p} />
              <button className="w-full rounded-lg brand-gradient-vivid px-4 py-3 text-sm font-semibold text-white glow transition hover:opacity-90">
                Оплатить {PLANS[p].priceRub.toLocaleString("ru-RU")} ₽
              </button>
            </form>
            <p className="mt-2 text-center text-xs text-ink-500">
              Нажимая «Оплатить», вы принимаете{" "}
              <Link href="/terms" className="underline">оферту</Link>.
            </p>
          </div>
        ))}
      </div>

      {/* история платежей */}
      {payments.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-xl border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">Дата</th>
                <th className="px-4 py-3 font-medium">План</th>
                <th className="px-4 py-3 font-medium">Сумма</th>
                <th className="px-4 py-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-3 text-ink-700">{p.createdAt.toLocaleString("ru-RU")}</td>
                  <td className="px-4 py-3 text-slate-900">{PLANS[p.plan].name}</td>
                  <td className="px-4 py-3 text-ink-700">{(p.amount / 100).toLocaleString("ru-RU")} ₽</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-0.5 text-xs ${
                      p.status === "CONFIRMED" ? "bg-mint-100 text-mint-700"
                      : p.status === "PENDING" ? "bg-amber-50 text-amber-700"
                      : "bg-red-50 text-red-600"
                    }`}>
                      {p.status === "CONFIRMED" ? "Оплачен" : p.status === "PENDING" ? "Ожидает оплаты" : "Ошибка"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-3 text-xs text-ink-500">
            Платёжный шлюз (ЮMoney) пока не подключён: после нажатия «Оплатить» платёж
            создаётся в статусе «Ожидает оплаты». Когда шлюз будет подключён, здесь
            появится редирект на форму оплаты, а подтверждение активирует тариф автоматически.
          </p>
        </div>
      )}
    </div>
  );
}

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min(100, Math.round((used / max) * 100));
  const danger = pct >= 90;
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="text-sm text-ink-500">{label}</div>
      <div className="mt-1 font-semibold text-slate-900">
        {used.toLocaleString("ru-RU")} / {max.toLocaleString("ru-RU")}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
        <div
          className={danger ? "h-full bg-red-400" : "h-full brand-gradient"}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
