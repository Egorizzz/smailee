import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PLANS, effectivePlan } from "@/lib/plans";
import { saveOnboarding } from "../onboarding/actions";

/**
 * Настройки (TO BE, R1): всё редко используемое в одном месте —
 * «Мой бизнес» (данные для ИИ), режим модерации, тариф.
 * Бывшая вкладка «Мой бизнес» стала шагом онбординга + этим разделом.
 */
export default async function SettingsPage() {
  const user = await requireUser();
  const plan = effectivePlan(user.plan, user.planExpiresAt);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900">Настройки</h1>
      <p className="mt-1 text-ink-500">
        Данные о бизнесе (на них опирается ИИ), модерация ответов и тариф.
      </p>

      {/* тариф */}
      <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-line bg-white p-5">
        <div>
          <div className="text-sm text-ink-500">Тариф</div>
          <div className="text-lg font-bold text-slate-900">{PLANS[plan].name}</div>
          {user.planExpiresAt && (
            <div className="text-xs text-ink-500">
              до {user.planExpiresAt.toLocaleDateString("ru-RU")}
            </div>
          )}
        </div>
        <Link
          href="/app/billing"
          className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700"
        >
          Управлять тарифом →
        </Link>
      </div>

      {/* мой бизнес */}
      <h2 className="mt-8 text-lg font-semibold text-slate-900">Мой бизнес</h2>
      <p className="mt-1 text-sm text-ink-500">
        ИИ пишет письма и ведёт диалог, опираясь на эти данные.
      </p>

      <form action={saveOnboarding} className="mt-4 space-y-5">
        <Field label="Название компании">
          <input
            name="companyName"
            defaultValue={user.companyName ?? ""}
            placeholder="ООО «Ваша компания»"
            className="input"
          />
        </Field>

        <Field label="Сайт">
          <input
            name="websiteUrl"
            defaultValue={user.websiteUrl ?? ""}
            placeholder="https://example.ru"
            className="input"
          />
        </Field>

        <Field
          label="Ваш оффер / ценностное предложение"
          hint="Что вы предлагаете и в чём выгода для клиента"
        >
          <textarea
            name="offer"
            defaultValue={user.offer ?? ""}
            rows={4}
            placeholder="Например: помогаем юридическим компаниям автоматизировать документооборот и экономить до 15 часов в неделю."
            className="input"
          />
        </Field>

        <Field
          label="Целевая аудитория"
          hint="Кого вы ищете: ниша, роль, размер бизнеса"
        >
          <textarea
            name="targetAudience"
            defaultValue={user.targetAudience ?? ""}
            rows={3}
            placeholder="Например: маркетинговые агентства и консалтинговые компании, 10–50 сотрудников, ЛПР — владелец или руководитель отдела."
            className="input"
          />
        </Field>

        <label className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
          <input
            type="checkbox"
            name="aiModerationEnabled"
            defaultChecked={user.aiModerationEnabled}
            className="mt-1"
          />
          <span>
            <span className="block text-sm font-medium text-slate-900">
              Модерация ответов ИИ
            </span>
            <span className="mt-0.5 block text-xs text-ink-500">
              Пока включено — ИИ готовит ответ клиенту, но не отправляет сам:
              вы одобряете каждый ответ в «Лидах». Выключите, когда будете
              готовы доверить ИИ отправку без проверки.
            </span>
          </span>
        </label>

        <button className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90">
          Сохранить
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-900">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}
      <div className="mt-2">{children}</div>
    </label>
  );
}
