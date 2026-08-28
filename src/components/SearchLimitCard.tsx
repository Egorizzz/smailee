"use client";

import { useEffect, useState } from "react";
import {
  searchLimitPercent,
  type DeepSearchRiskAssessment,
  type ProspectingSearchMode,
} from "@/lib/company-data/searchBudget";

type SearchLimitBudget = {
  used: number;
  limit: number;
};

export function SearchLimitCard({ budget, mode, estimatedContactCapacity, forecastReliable, isTrial, renewsAt }: {
  budget: SearchLimitBudget;
  mode: ProspectingSearchMode;
  estimatedContactCapacity: number;
  forecastReliable: boolean;
  isTrial: boolean;
  renewsAt?: string | null;
}) {
  const progress = searchLimitPercent({ used: budget.used, limit: budget.limit });
  const usedPercent = Math.min(100, progress.used);

  const deep = mode === "deep";

  return <div className={`sticky top-0 z-30 mt-4 rounded-xl border px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur ${deep ? "border-amber-200 bg-amber-50/95" : "border-line bg-white/95"}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className={`flex items-center gap-1.5 text-xs font-semibold ${deep ? "text-amber-900" : "text-slate-900"}`}>
          <span>Лимит поиска</span>
          <span className="group relative inline-flex" tabIndex={0} aria-describedby="search-limit-renewal-tooltip">
            <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 fill-none stroke-current ${deep ? "text-amber-700" : "text-ink-400"}`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 4.75h11v7.5h-6l-3.5 3v-3H4.5z" /><path d="M7.25 8.5h5.5" /></svg>
            <span id="search-limit-renewal-tooltip" role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-64 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-normal leading-4 text-white shadow-xl group-hover:block group-focus:block">
              {isTrial
                ? "На пробном тарифе лимит не обновляется. Чтобы продолжить поиск, перейдите на платный тариф."
                : renewsAt
                  ? <>Текущий период действует до <span className="metric-number">{new Date(renewsAt).toLocaleDateString("ru-RU")}</span>. Лимит обновится после подтверждения следующей оплаты.</>
                  : "Лимит обновится после подтверждения следующей оплаты."}
            </span>
          </span>
        </div>
        {deep && !forecastReliable
          ? <div className="mt-0.5 text-[11px] font-medium text-amber-800">Прогноз количества контактов, на которое хватит лимита, появится после тестового поиска с заданными параметрами.</div>
          : <div className={`mt-0.5 text-[11px] ${deep ? "text-amber-800" : "text-ink-500"}`}>Остатка хватит примерно на <span className={`metric-number font-semibold ${deep ? "text-amber-900" : "text-ink-700"}`}>{estimatedContactCapacity.toLocaleString("ru-RU")}</span> контактов {deep ? "глубокого" : "обычного"} поиска</div>}
      </div>
      <span className="metric-number shrink-0 text-sm font-semibold text-slate-900">{Math.round(usedPercent)}%</span>
    </div>

    <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-label="Лимит поиска" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedPercent)}>
      <span className={deep ? "bg-amber-500" : "bg-mint-600"} style={{ width: `${usedPercent}%` }} />
    </div>
  </div>;
}

export function DeepSearchConsentDialog({ assessment, loading, onStandard, onContinue, onClose }: {
  assessment: DeepSearchRiskAssessment;
  loading: boolean;
  onStandard: () => void;
  onContinue: () => void;
  onClose: () => void;
}) {
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape" && !loading) onClose(); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [loading, onClose]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="deep-search-limit-title">
    <button type="button" className="absolute inset-0" aria-label="Закрыть" onClick={() => { if (!loading) onClose(); }} />
    <div className="relative w-full max-w-lg rounded-xl border border-line bg-white p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-amber-700">Нужен ваш выбор</div>
          <h2 id="deep-search-limit-title" className="mt-1 text-lg font-semibold text-slate-900">Глубокий поиск расходует лимит быстрее</h2>
        </div>
        <button type="button" disabled={loading} onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-600 hover:bg-surface disabled:opacity-50">Закрыть</button>
      </div>

      <p className="mt-4 text-sm leading-6 text-ink-600">Безопасный этап глубокого поиска завершён. Все уже найденные контакты сохранены, а продолжение может уменьшить итоговое количество контактов в этом периоде.</p>
      <div className="mt-4 rounded-lg bg-[#fafbf9] p-3">
        {assessment.forecastReliable && assessment.estimatedMaxContacts != null
          ? <p className="text-sm leading-5 text-slate-900">При текущей конверсии лимита хватит ориентировочно максимум на <span className="metric-number font-semibold">{assessment.estimatedMaxContacts.toLocaleString("ru-RU")}</span> новых контактов.</p>
          : <p className="text-sm leading-5 text-slate-900">На текущем количестве данных недостаточно, чтобы предсказать число найденных контактов при этих параметрах.</p>}
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white ring-1 ring-line">
          <span className="block h-full bg-mint-600" style={{ width: `${assessment.projectedUsedPercent}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-ink-500"><span>Лимиты поиска</span><span className="metric-number font-medium text-ink-700">{Math.round(assessment.projectedUsedPercent)}%</span></div>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-3 text-xs leading-5 text-ink-700">
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-700" />
        <span>Я понимаю, что при продолжении глубокого поиска лимита может хватить на меньшее количество контактов.</span>
      </label>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" disabled={loading} onClick={onClose} className="px-2 py-2 text-sm font-medium text-ink-500 hover:text-slate-900 disabled:opacity-50">Оставить найденное</button>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" disabled={loading} onClick={onStandard} className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">Перейти к обычному</button>
          <button type="button" disabled={loading || !accepted} onClick={onContinue} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-700 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40">Продолжить глубокий</button>
        </div>
      </div>
    </div>
  </div>;
}
