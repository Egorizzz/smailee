import { requireUser } from "@/lib/auth";
import { saveOnboarding } from "./actions";

export default async function OnboardingPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900">Мой бизнес</h1>
      <p className="mt-1 text-ink-500">
        Расскажите AI про ваш продукт и клиентов — на основе этого он будет
        писать персональные письма.
      </p>

      <form action={saveOnboarding} className="mt-8 space-y-5">
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
