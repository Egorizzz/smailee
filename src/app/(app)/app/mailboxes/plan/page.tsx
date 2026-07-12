import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { calcInfraPlan } from "@/lib/mail/planCalculator";

export default async function PlanCalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{ volume?: string }>;
}) {
  const user = await requireUser();
  const { volume } = await searchParams;
  const parsed = volume ? Math.max(0, Math.floor(Number(volume))) : 0;
  const plan = parsed > 0 ? calcInfraPlan(parsed, user.companyName ?? undefined) : null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/app/mailboxes" className="text-sm text-ink-500 hover:text-slate-900">
        ← Ящики
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">План инфраструктуры</h1>
      <p className="mt-1 text-ink-500">
        Посчитаем, сколько доменов, персон и ящиков нужно под ваш объём. Система
        считает — вы поднимаете инфраструктуру руками (модель C).
      </p>

      <form method="get" className="mt-6 flex items-end gap-3 rounded-2xl border border-line bg-white p-5">
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
        <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
          Рассчитать
        </button>
      </form>

      {plan && (
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {[
              { l: "Доменов", v: plan.domains },
              { l: "Ящиков", v: plan.mailboxes },
              { l: "Писем/день", v: plan.perDayNeeded },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border border-line bg-white p-4 text-center">
                <div className="text-2xl font-bold text-slate-900">{s.v}</div>
                <div className="text-sm text-ink-500">{s.l}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-line bg-white p-5">
            <div className="text-sm font-semibold text-slate-900">Схема</div>
            <div className="mt-1 text-lg font-bold text-mint-700">{plan.scheme}</div>
            <div className="mt-1 text-sm text-ink-500">
              {plan.aliasesPerPersona} алиаса на персону.
            </div>
          </div>

          <div className="rounded-xl border border-line bg-white p-5">
            <div className="text-sm font-semibold text-slate-900">Подсказки по доменам</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {plan.domainNameHints.map((d) => (
                <span key={d} className="rounded-lg bg-surface px-3 py-1 font-mono text-sm text-ink-700">{d}</span>
              ))}
            </div>
            <div className="mt-3 text-sm font-semibold text-slate-900">Алиасы персоны (пример «Иван Иванов»)</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {plan.aliasHints.map((a) => (
                <span key={a} className="rounded-lg bg-surface px-3 py-1 font-mono text-sm text-ink-700">{a}@…</span>
              ))}
            </div>
          </div>

          <ul className="space-y-2 rounded-xl border border-line bg-surface p-5 text-sm text-ink-700">
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
