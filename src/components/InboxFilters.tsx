"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Option = { value: string; label: string };

export function InboxFilters({ campaigns, mailboxes, selectedCampaign, selectedMailbox, selectedState, selectedScope, query, autoPingFilter }: {
  campaigns: Option[];
  mailboxes: Option[];
  selectedCampaign?: string;
  selectedMailbox?: string;
  selectedState?: string;
  selectedScope?: string;
  query?: string;
  autoPingFilter?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = Number(Boolean(selectedCampaign)) + Number(Boolean(selectedMailbox)) + Number(Boolean(selectedState && selectedState !== "active")) + Number(selectedScope === "replied") + Number(autoPingFilter === "attention");

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-slate-900 hover:border-slate-400">
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 5h14M5.5 10h9M8 15h4" strokeLinecap="round" /></svg>
        Фильтры
        {count > 0 && <span className="metric-number rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] text-white">{count}</span>}
      </button>
      {open && (
        <form action="/app/inbox" method="get" className="absolute right-0 top-11 z-30 w-72 rounded-2xl border border-line bg-white p-4 shadow-[0_20px_60px_rgba(15,23,42,0.16)]">
          {query && <input type="hidden" name="q" value={query} />}
          <div className="flex items-center justify-between border-b border-line pb-3"><span className="text-sm font-semibold text-slate-900">Фильтры Inbox</span><button type="button" onClick={() => setOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full text-ink-500 hover:bg-surface">×</button></div>
          <div className="space-y-4 py-4">
            <label className="block"><span className="text-xs font-medium text-ink-500">Диалоги</span><select name="scope" defaultValue={selectedScope ?? "all"} className="input mt-1 w-full text-sm"><option value="all">Все коммуникации</option><option value="replied">Только с ответом клиента</option></select></label>
            <label className="block"><span className="text-xs font-medium text-ink-500">Состояние</span><select name="state" defaultValue={selectedState ?? "active"} className="input mt-1 w-full text-sm"><option value="active">Все активные</option><option value="unanswered">Нужен ответ</option><option value="warm">Тёплые</option><option value="frozen">Мороз</option><option value="refused">Отказы</option><option value="processed">Обработанные</option></select></label>
            <label className="block"><span className="text-xs font-medium text-ink-500">Автопинг</span><select name="autoping" defaultValue={autoPingFilter ?? "all"} className="input mt-1 w-full text-sm"><option value="all">Все состояния</option><option value="attention">Требует внимания</option></select></label>
            <label className="block"><span className="text-xs font-medium text-ink-500">Кампания</span><select name="campaign" defaultValue={selectedCampaign ?? ""} className="input mt-1 w-full text-sm"><option value="">Все кампании</option>{campaigns.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="block"><span className="text-xs font-medium text-ink-500">Почтовый ящик</span><select name="mailbox" defaultValue={selectedMailbox ?? ""} className="input mt-1 w-full text-sm"><option value="">Все ящики</option>{mailboxes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-3"><Link href="/app/inbox" className="rounded-full px-3 py-2 text-xs font-medium text-ink-500 hover:bg-surface">Сбросить</Link><button className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white">Применить</button></div>
        </form>
      )}
    </div>
  );
}
