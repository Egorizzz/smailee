"use client";

import { createSeriesCampaign } from "./actions";

export function NewSeriesForm({
  segments,
  senders,
}: {
  segments: string[];
  senders: { id: string; label: string }[];
}) {
  return (
    <form action={createSeriesCampaign} className="space-y-4 rounded-2xl border border-line bg-white p-6">
      <label className="block">
        <span className="text-sm font-medium text-slate-900">Название серии</span>
        <input name="name" className="input mt-2" placeholder="Банкротство: серия для юристов" required />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-900">Тема серии</span>
        <textarea
          name="topic"
          rows={3}
          className="input mt-2"
          placeholder='Например: "Что делать при банкротстве компании"'
          required
        />
        <span className="mt-1 block text-xs text-ink-500">
          AI сам придумает темы каждого письма серии на основе этого.
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Писем в серии</span>
          <input name="totalSteps" type="number" min={1} max={20} defaultValue={5} className="input mt-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Частота (дней между письмами)</span>
          <input name="frequencyDays" type="number" min={1} max={30} defaultValue={3} className="input mt-2" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Сегмент базы</span>
          <select name="segment" className="input mt-2">
            <option value="">Все контакты</option>
            {segments.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Отправитель</span>
          <select name="senderId" className="input mt-2">
            <option value="">— выбрать —</option>
            {senders.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      <button className="w-full rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-90">
        Создать и спланировать серию
      </button>
    </form>
  );
}
