/**
 * Реалистичный «скриншот» продукта — сверстан кодом (не картинка),
 * чтобы текст был чётким. Показывает суть: пришёл ответ → AI ведёт диалог →
 * лид квалифицирован как «тёплый».
 */
export function ProductMock() {
  return (
    <div className="rounded-2xl border border-line bg-white shadow-xl shadow-slate-200/50">
      {/* строка окна */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-400" />
        <span className="h-3 w-3 rounded-full bg-yellow-400" />
        <span className="h-3 w-3 rounded-full bg-green-400" />
        <span className="ml-3 text-xs text-ink-500">Smailee · Диалог с лидом</span>
      </div>

      <div className="grid gap-0 md:grid-cols-[1fr_240px]">
        {/* лента диалога */}
        <div className="space-y-3 p-5">
          {/* входящее письмо */}
          <div className="max-w-[85%]">
            <div className="mb-1 text-xs text-ink-500">
              Ответ от клиента · ООО «Ромашка»
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-surface px-4 py-3 text-sm text-ink-700">
              Здравствуйте! Интересно, а сколько это стоит и подойдёт ли для
              компании из 20 человек?
            </div>
          </div>

          {/* ответ AI */}
          <div className="ml-auto max-w-[85%] text-right">
            <div className="mb-1 flex items-center justify-end gap-1.5 text-xs text-ink-500">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full brand-gradient text-[9px] font-bold text-white">
                AI
              </span>
              Smailee ответил автоматически
            </div>
            <div className="inline-block rounded-2xl rounded-tr-sm brand-gradient px-4 py-3 text-left text-sm text-white">
              Добрый день! Да, отлично подойдёт для команды до 20 человек.
              Подготовлю расчёт под вашу задачу — на какой email удобно прислать?
            </div>
          </div>

          {/* входящее */}
          <div className="max-w-[85%]">
            <div className="rounded-2xl rounded-tl-sm bg-surface px-4 py-3 text-sm text-ink-700">
              Отправьте на my@romashka.ru, готовы обсудить на неделе.
            </div>
          </div>
        </div>

        {/* панель квалификации лида */}
        <aside className="border-t border-line bg-surface/60 p-5 md:border-l md:border-t-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Квалификация лида
          </div>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-mint-100 px-3 py-1 text-sm font-semibold text-mint-700">
            <span className="h-2 w-2 rounded-full bg-mint-500" />
            Тёплый лид
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-ink-500">Компания</dt>
              <dd className="font-medium text-ink-700">ООО «Ромашка»</dd>
            </div>
            <div>
              <dt className="text-ink-500">Интерес</dt>
              <dd className="font-medium text-ink-700">Цена, команда 20 чел.</dd>
            </div>
            <div>
              <dt className="text-ink-500">Готов к диалогу</dt>
              <dd className="font-medium text-mint-700">Да, на неделе</dd>
            </div>
          </dl>
          <button className="mt-5 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700">
            Передать в Битрикс24 →
          </button>
        </aside>
      </div>
    </div>
  );
}
