/**
 * Реалистичный «скриншот» продукта — сверстан кодом (чёткий текст).
 * Показывает EMAIL-тред в кабинете: пришёл ответ письмом → AI ответил письмом →
 * лид квалифицирован как «тёплый». Это отражает реальность (почта, не чат).
 */
export function ProductMock() {
  return (
    <div className="rounded-2xl border border-line bg-white shadow-xl shadow-indigo-100/60">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-400" />
        <span className="h-3 w-3 rounded-full bg-yellow-400" />
        <span className="h-3 w-3 rounded-full bg-green-400" />
        <span className="ml-3 text-xs text-ink-500">Smailee · Переписка с лидом</span>
      </div>

      <div className="grid gap-0 md:grid-cols-[1fr_240px]">
        <div className="space-y-3 p-5">
          {/* входящее письмо */}
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line/70 bg-surface px-3 py-2 text-xs">
              <span className="font-medium text-slate-900">
                Клиент &lt;info@romashka.ru&gt;
              </span>
              <span className="text-ink-500">10:24</span>
            </div>
            <div className="px-3 py-2">
              <div className="mb-1 text-xs font-semibold text-ink-700">Re: Быстрый вопрос</div>
              <p className="text-xs text-ink-700">
                Здравствуйте! Интересно, а сколько это стоит для команды 20 человек?
              </p>
            </div>
          </div>

          {/* ответ AI письмом */}
          <div className="overflow-hidden rounded-xl border border-indigo-100 bg-indigo-50/40">
            <div className="flex items-center justify-between border-b border-line/70 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium text-slate-900">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full brand-gradient text-[8px] font-bold text-white">AI</span>
                Smailee ответил письмом
              </span>
              <span className="text-ink-500">10:24</span>
            </div>
            <div className="px-3 py-2">
              <div className="mb-1 text-xs font-semibold text-ink-700">Re: Быстрый вопрос</div>
              <p className="text-xs text-ink-700">
                Добрый день! Да, отлично подойдёт для команды до 20 человек.
                Подготовлю расчёт — на какой email удобно прислать?
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line/70 bg-surface px-3 py-2 text-xs">
              <span className="font-medium text-slate-900">Клиент &lt;info@romashka.ru&gt;</span>
              <span className="text-ink-500">11:03</span>
            </div>
            <div className="px-3 py-2 text-xs text-ink-700">
              Отправьте на my@romashka.ru, готовы обсудить на неделе.
            </div>
          </div>
        </div>

        {/* панель квалификации */}
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
          <button className="mt-5 w-full rounded-lg brand-gradient-vivid px-3 py-2 text-sm font-semibold text-white glow">
            Передать в Битрикс24 →
          </button>
        </aside>
      </div>
    </div>
  );
}
