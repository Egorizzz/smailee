"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Option = { value: string; label: string };

type FunnelFiltersProps = {
  actionPath: string;
  resetHref: string;
  campaigns?: Option[];
  segments?: Option[];
  selectedCampaigns?: string[];
  selectedSegments?: string[];
  dateFrom?: string;
  dateTo?: string;
  showOpens: boolean;
  canShowOpens: boolean;
};

function ChoiceGroup({
  name,
  label,
  options,
  selected,
}: {
  name: string;
  label: string;
  options: Option[];
  selected: string[];
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-900">{label}</legend>
      <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
        {options.length === 0 ? (
          <p className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-500">Пока нет вариантов</p>
        ) : (
          options.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-ink-700 hover:bg-surface">
              <input
                type="checkbox"
                name={name}
                value={option.value}
                defaultChecked={selected.includes(option.value)}
                className="h-4 w-4 rounded border-line accent-mint-600"
              />
              <span className="min-w-0 truncate">{option.label}</span>
            </label>
          ))
        )}
      </div>
    </fieldset>
  );
}

export function FunnelFilters({
  actionPath,
  resetHref,
  campaigns = [],
  segments = [],
  selectedCampaigns = [],
  selectedSegments = [],
  dateFrom,
  dateTo,
  showOpens,
  canShowOpens,
}: FunnelFiltersProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeCount = Number(Boolean(dateFrom)) + Number(Boolean(dateTo)) + selectedCampaigns.length + selectedSegments.length + Number(canShowOpens && !showOpens);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const activeLabels = [
    dateFrom && `С ${new Date(`${dateFrom}T00:00:00`).toLocaleDateString("ru-RU")}`,
    dateTo && `По ${new Date(`${dateTo}T00:00:00`).toLocaleDateString("ru-RU")}`,
    ...selectedCampaigns.map((id) => campaigns.find((option) => option.value === id)?.label).filter(Boolean),
    ...selectedSegments.map((id) => segments.find((option) => option.value === id)?.label).filter(Boolean),
  ].filter(Boolean) as string[];

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-slate-900 transition hover:border-slate-400"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 5h14M5.5 10h9M8 15h4" strokeLinecap="round" /></svg>
        Фильтры
        {activeCount > 0 && <span className="metric-number rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">{activeCount}</span>}
      </button>

      {activeLabels.slice(0, 3).map((label) => (
        <span key={label} className="max-w-48 truncate rounded-full bg-surface px-3 py-2 text-xs font-medium text-ink-700">{label}</span>
      ))}
      {activeLabels.length > 3 && <span className="metric-number rounded-full bg-surface px-3 py-2 text-xs font-medium text-ink-700">+{activeLabels.length - 3}</span>}
      {activeCount > 0 && <Link href={resetHref} className="px-2 py-2 text-xs font-medium text-ink-500 hover:text-slate-900">Сбросить</Link>}

      {open && (
        <div role="dialog" aria-label="Фильтры аналитики" className="absolute left-0 top-12 z-30 w-[min(42rem,calc(100vw-2.5rem))] rounded-2xl border border-line bg-white p-4 shadow-[0_20px_60px_rgba(15,23,42,0.14)] sm:p-5">
          <form action={actionPath} method="get">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <p className="font-semibold text-slate-900">Фильтры</p>
                <p className="mt-0.5 text-xs text-ink-500">Настройте выборку воронки</p>
              </div>
              <button type="button" aria-label="Закрыть фильтры" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-ink-500 hover:bg-surface hover:text-slate-900">×</button>
            </div>

            <div className="grid gap-5 py-5 sm:grid-cols-2">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <label className="rounded-xl border border-line px-3 py-2">
                    <span className="block text-xs font-medium text-ink-500">С даты</span>
                    <input name="from" type="date" defaultValue={dateFrom} className="metric-number mt-1 w-full bg-transparent text-sm text-slate-900 outline-none" />
                  </label>
                  <label className="rounded-xl border border-line px-3 py-2">
                    <span className="block text-xs font-medium text-ink-500">По дату</span>
                    <input name="to" type="date" defaultValue={dateTo} className="metric-number mt-1 w-full bg-transparent text-sm text-slate-900 outline-none" />
                  </label>
                </div>
                {campaigns.length > 0 && <ChoiceGroup name="campaign" label="Кампании" options={campaigns} selected={selectedCampaigns} />}
              </div>
              <div className="space-y-4">
                {segments.length > 0 && <ChoiceGroup name="segment" label="Сегменты" options={segments} selected={selectedSegments} />}
                <label className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-sm ${canShowOpens ? "cursor-pointer border-line text-ink-700" : "cursor-not-allowed border-line bg-surface text-ink-500"}`}>
                  <span>
                    <span className="block font-medium text-slate-900">Показывать открытия</span>
                    {!canShowOpens && <span className="mt-0.5 block text-xs text-ink-500">Трекинг выключен в части кампаний</span>}
                  </span>
                  <input type="hidden" name="opens" value="0" />
                  <input type="checkbox" name="opens" value="1" defaultChecked={showOpens} disabled={!canShowOpens} className="h-4 w-4 accent-mint-600" />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
              <Link href={resetHref} onClick={() => setOpen(false)} className="rounded-full px-4 py-2 text-sm font-medium text-ink-500 hover:bg-surface hover:text-slate-900">Сбросить</Link>
              <button className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800">Применить</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
