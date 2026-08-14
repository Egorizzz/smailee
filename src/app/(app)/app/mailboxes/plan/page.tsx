import Link from "next/link";
import { requireCapability } from "@/lib/organization";
import { calcInfraPlan } from "@/lib/mail/planCalculator";

export default async function PlanCalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{ volume?: string }>;
}) {
  const { owner: user } = await requireCapability("INFRASTRUCTURE_MANAGE");
  const { volume } = await searchParams;
  const parsed = volume ? Math.max(0, Math.floor(Number(volume))) : 0;
  const plan = parsed > 0 ? calcInfraPlan(parsed, user.companyName ?? undefined) : null;

  return (
    <div className="mx-auto max-w-3xl pb-8">
      <Link href="/app/mailboxes" className="text-sm text-ink-500 hover:text-slate-900">
        ← Ящики
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">План инфраструктуры</h1>
        <span className="rounded-full bg-mint-50 px-2.5 py-1 text-xs font-semibold text-mint-700">
          По правилам Trigga
        </span>
      </div>
      <p className="mt-1 text-ink-500">
        Рекомендованный флот под месячный объём — с резервом на цепочки,
        ротацию и здоровье ящиков.
      </p>

      <form method="get" className="mt-6 flex flex-col gap-3 rounded-2xl border border-line bg-white p-5 shadow-sm sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="text-sm font-medium text-slate-900">Получателей в месяц</span>
          <input
            name="volume"
            type="number"
            min={1}
            defaultValue={parsed || undefined}
            placeholder="напр. 10000"
            className="input mt-1"
            required
          />
        </label>
        <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white sm:shrink-0">
          Рассчитать
        </button>
      </form>

      {plan && (
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { l: "Доменов", v: plan.domains },
              { l: "Ящиков", v: plan.mailboxes },
              { l: "Контактов/ящик", v: plan.contactsPerMailbox },
              { l: "Холодная ёмкость/день", v: plan.coldCapacityPerDay },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border border-line bg-white p-4">
                <div className="text-2xl font-bold text-slate-900">{s.v}</div>
                <div className="mt-0.5 text-xs leading-snug text-ink-500">{s.l}</div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-mint-200 bg-white">
            <div className="border-b border-mint-100 bg-mint-50 px-5 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-mint-700">Рекомендация Trigga</div>
              <div className="mt-1 text-xl font-bold text-slate-900">{plan.scheme}</div>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">Распределение по доменам</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {plan.mailboxDistribution.map((count, index) => (
                    <span key={index} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-700">
                      Домен {index + 1}: <b className="text-slate-900">{count}</b>
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg bg-surface p-3 text-sm text-ink-700">
                <b className="text-slate-900">Почему не {Math.ceil(plan.firstTouchesPerDay / 30)}?</b>
                <p className="mt-1 leading-relaxed">
                  Это был бы только арифметический минимум по 30 письмам в день.
                  Trigga считает 1 ящик на 200 получателей, чтобы не работать на пределе.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-white p-5">
            <div className="text-sm font-semibold text-slate-900">Подсказки по доменам</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {plan.domainNameHints.map((d) => (
                <span key={d} className="rounded-lg bg-surface px-3 py-1 font-mono text-sm text-ink-700">{d}</span>
              ))}
            </div>
          </div>

          <ul className="space-y-2 rounded-xl border border-line bg-surface p-5 text-sm leading-relaxed text-ink-700">
            {plan.notes.map((n, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-mint-500">•</span>
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
