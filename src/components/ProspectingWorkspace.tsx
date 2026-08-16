"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Row = {
  companyId: string; inn?: string; name?: string; domain?: string;
  companyEmails: string[]; hunterEmails: string[]; phones: string[]; availableFields: number;
};
type Result = { provider: string; rows: Row[]; summary: Record<string, number>; usage: { company: { requests: number }; hunter: { requests: number; credits?: number } } };
type HunterContact = { email: string; firstName?: string; lastName?: string; position?: string; department?: string; confidence?: number };

export function ProspectingWorkspace({ isAdmin, canManage }: { isAdmin: boolean; canManage: boolean }) {
  const [filters, setFilters] = useState({ okved: "62.01", region: "", revenueFrom: "", employeesFrom: "", hasWebsite: true, hasEmail: false, limit: "25" });
  const [result, setResult] = useState<Result | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [segment, setSegment] = useState("Новая подборка");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [activeRow, setActiveRow] = useState<Row | null>(null);
  const [enrichingCompanyId, setEnrichingCompanyId] = useState<string | null>(null);
  const [hunterDetails, setHunterDetails] = useState<Record<string, HunterContact[]>>({});
  const [importedSegment, setImportedSegment] = useState<string | null>(null);
  const contacts = useMemo(() => result?.rows.flatMap((row) => [...new Set([...row.companyEmails, ...row.hunterEmails])].map((email) => ({ email, company: row.name }))) ?? [], [result]);

  async function search() {
    setLoading(true); setNotice(""); setSelected(new Set());
    try {
      const response = await fetch("/api/company-data/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        okved: filters.okved, region: filters.region || undefined,
        revenueFrom: filters.revenueFrom ? Number(filters.revenueFrom) : undefined,
        employeesFrom: filters.employeesFrom ? Number(filters.employeesFrom) : undefined,
        hasWebsite: filters.hasWebsite, hasEmail: filters.hasEmail, limit: Number(filters.limit),
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setResult(body);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Поиск не выполнен"); }
    finally { setLoading(false); }
  }

  async function addContacts() {
    const chosen = contacts.filter((item) => selected.has(item.email));
    if (!chosen.length) return;
    setLoading(true); setNotice("");
    try {
      const response = await fetch("/api/company-data/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ segment, contacts: chosen }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setNotice(`Добавлено ${body.imported} контактов в сегмент «${body.segment}»`);
      setImportedSegment(body.segment);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Контакты не добавлены"); }
    finally { setLoading(false); }
  }

  async function enrich(row: Row) {
    if (!row.domain) return;
    setEnrichingCompanyId(row.companyId); setNotice("");
    try {
      const response = await fetch("/api/company-data/enrich", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: row.domain, limit: 10 }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const details = body.contacts as HunterContact[];
      setHunterDetails((current) => ({ ...current, [row.companyId]: details }));
      setResult((current) => current ? {
        ...current,
        rows: current.rows.map((item) => item.companyId === row.companyId ? { ...item, hunterEmails: details.map((contact) => contact.email) } : item),
        usage: { ...current.usage, hunter: body.usage },
      } : current);
      setActiveRow((current) => current?.companyId === row.companyId ? { ...current, hunterEmails: details.map((contact) => contact.email) } : current);
      if (!details.length) setNotice(`Hunter не нашёл публичных рабочих адресов для ${row.domain}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Контакты не найдены"); }
    finally { setEnrichingCompanyId(null); }
  }

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-ink-500"><Link href="/app/contacts" className="hover:text-slate-900">Контакты</Link><span>/</span><span>Поиск базы</span></div>
          <h1 className="text-[30px] font-semibold leading-tight text-slate-900">Найдите компании для кампании</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-500">Задайте признаки бизнеса. Smailee подберёт компании, найдёт рабочие адреса и покажет источник каждого контакта до добавления в базу.</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && <button onClick={() => setComparisonOpen(true)} className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink-700 hover:bg-surface">Сравнить источники</button>}
          <Link href="/app/contacts" className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink-700 hover:bg-surface">Моя база</Link>
        </div>
      </div>

      <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border border-line bg-[#fafbf9] p-4 xl:sticky xl:top-6">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-900">Критерии поиска</h2><span className="metric-number rounded-md bg-white px-2 py-1 text-[11px] text-ink-500 ring-1 ring-line">И</span></div>
          <div className="mt-5 space-y-4">
            <Field label="Основной ОКВЭД" hint="Например, 62.01">
              <input className="input" value={filters.okved} onChange={(e) => setFilters({ ...filters, okved: e.target.value })} />
            </Field>
            <Field label="Регион"><input className="input" placeholder="Москва" value={filters.region} onChange={(e) => setFilters({ ...filters, region: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Выручка от"><input type="number" className="input" placeholder="₽" value={filters.revenueFrom} onChange={(e) => setFilters({ ...filters, revenueFrom: e.target.value })} /></Field>
              <Field label="Сотрудников от"><input type="number" className="input" placeholder="10" value={filters.employeesFrom} onChange={(e) => setFilters({ ...filters, employeesFrom: e.target.value })} /></Field>
            </div>
            <Toggle label="Есть сайт" checked={filters.hasWebsite} onChange={(value) => setFilters({ ...filters, hasWebsite: value })} />
            <Toggle label="Уже есть email" checked={filters.hasEmail} onChange={(value) => setFilters({ ...filters, hasEmail: value })} />
            <Field label="Показать компаний"><select className="input" value={filters.limit} onChange={(e) => setFilters({ ...filters, limit: e.target.value })}><option>10</option><option>25</option><option>50</option><option>100</option></select></Field>
          </div>
          <button onClick={search} disabled={loading || !filters.okved} className="btn-primary mt-5 w-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{loading ? "Ищем…" : "Найти компании"}</button>
          <p className="mt-3 text-[11px] leading-4 text-ink-500">Email ищутся только для компаний с доменом. Перед запуском вы увидите итоговую выборку.</p>
        </aside>

        <section className="min-w-0">
          {notice && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-mint-200 bg-mint-50 px-4 py-3 text-sm text-mint-700"><span>{notice}</span>{importedSegment && <Link href="/app/campaigns/new" className="font-semibold underline underline-offset-2">Создать кампанию с сегментом</Link>}</div>}
          {!result ? <EmptyState loading={loading} /> : <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric value={result.summary.companies ?? 0} label="компаний" />
              <Metric value={result.summary.withDomain ?? 0} label="с доменом" />
              <Metric value={result.rows.filter((row) => row.companyEmails.length + row.hunterEmails.length > 0).length} label="с доступным email" tone />
              <Metric value={contacts.length} label="уникальных адресов" />
            </div>
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-white p-3 sm:flex-row sm:items-center">
              <div className="text-sm text-ink-500"><span className="metric-number font-semibold text-slate-900">{selected.size}</span> выбрано из {contacts.length}</div>
              <div className="flex flex-1 gap-2 sm:justify-end">
                <input aria-label="Название сегмента" className="input max-w-56" value={segment} onChange={(e) => setSegment(e.target.value)} />
                <button disabled={!canManage || !selected.size || loading} onClick={addContacts} className="btn-primary shrink-0 px-4 py-2 text-sm font-semibold disabled:opacity-40">Добавить в базу</button>
              </div>
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-line bg-white">
              <div className="scroll-x"><table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-[#fafbf9] text-xs text-ink-500"><tr><th className="w-11 px-4 py-3"><input type="checkbox" aria-label="Выбрать все" checked={contacts.length > 0 && selected.size === contacts.length} onChange={(e) => setSelected(e.target.checked ? new Set(contacts.map((x) => x.email)) : new Set())} /></th><th className="px-3 py-3 font-medium">Компания</th><th className="px-3 py-3 font-medium">Контакты</th><th className="px-3 py-3 font-medium">Источник</th><th className="px-3 py-3 font-medium">Данные</th></tr></thead>
                <tbody>{result.rows.map((row) => {
                  const emails = [...new Set([...row.companyEmails, ...row.hunterEmails])];
                  return <tr key={row.companyId} className="border-t border-line align-top hover:bg-[#fbfcfb]"><td className="px-4 py-4"><input type="checkbox" aria-label={`Выбрать ${row.name}`} disabled={!emails.length} checked={emails.length > 0 && emails.every((email) => selected.has(email))} onChange={(e) => setSelected((current) => { const next = new Set(current); emails.forEach((email) => e.target.checked ? next.add(email) : next.delete(email)); return next; })} /></td><td className="px-3 py-4"><button onClick={() => setActiveRow(row)} className="text-left font-medium text-slate-900 hover:text-mint-700">{row.name ?? "Без названия"}</button><div className="metric-number mt-1 text-xs text-ink-500">ИНН {row.inn ?? "—"}</div>{row.domain && <a href={`https://${row.domain}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-mint-700 hover:underline">{row.domain}</a>}</td><td className="px-3 py-4">{emails.length ? <div className="space-y-1.5">{emails.slice(0, 3).map((email) => <label key={email} className="flex items-center gap-2 text-xs text-ink-700"><input type="checkbox" checked={selected.has(email)} onChange={(e) => setSelected((current) => { const next = new Set(current); e.target.checked ? next.add(email) : next.delete(email); return next; })}/><span>{email}</span></label>)}{emails.length > 3 && <div className="text-xs text-ink-500">ещё {emails.length - 3}</div>}</div> : row.domain ? <button onClick={() => enrich(row)} disabled={enrichingCompanyId === row.companyId} className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface disabled:opacity-50">{enrichingCompanyId === row.companyId ? "Ищем…" : "Найти email"}</button> : <span className="text-xs text-ink-500">Нет домена для поиска</span>}</td><td className="px-3 py-4"><div className="flex flex-wrap gap-1.5">{row.companyEmails.length > 0 && <Badge>Реестр</Badge>}{row.hunterEmails.length > 0 && <Badge tone="green">Hunter</Badge>}</div></td><td className="metric-number px-3 py-4 text-xs text-ink-500"><button onClick={() => setActiveRow(row)} className="hover:text-mint-700">{row.availableFields} полей</button></td></tr>;
                })}</tbody>
              </table></div>
              <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-ink-500"><span>Источник компаний: {result.provider}</span><span className="metric-number">{result.usage.company.requests} запросов · Hunter запускается по компании</span></div>
            </div>
          </>}
        </section>
      </div>
      {comparisonOpen && <ComparisonDrawer filters={filters} onClose={() => setComparisonOpen(false)} />}
      {activeRow && <CompanyDrawer row={result?.rows.find((row) => row.companyId === activeRow.companyId) ?? activeRow} details={hunterDetails[activeRow.companyId] ?? []} enriching={enrichingCompanyId === activeRow.companyId} onEnrich={() => enrich(activeRow)} onClose={() => setActiveRow(null)} />}
    </div>
  );
}

function CompanyDrawer({ row, details, enriching, onEnrich, onClose }: { row: Row; details: HunterContact[]; enriching: boolean; onEnrich: () => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-40 flex justify-end bg-black/20" role="dialog" aria-modal="true" aria-label="Карточка компании"><button className="absolute inset-0 cursor-default" aria-label="Закрыть" onClick={onClose} /><aside className="relative h-full w-full max-w-md overflow-y-auto border-l border-line bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><div className="text-xs text-ink-500">Карточка компании</div><h2 className="mt-1 text-xl font-semibold text-slate-900">{row.name ?? "Без названия"}</h2></div><button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm">Закрыть</button></div><dl className="mt-6 grid grid-cols-2 gap-3 text-sm"><Info label="ИНН" value={row.inn ?? "—"} numeric /><Info label="Домен" value={row.domain ?? "—"} /><Info label="Телефоны" value={row.phones.join(", ") || "—"} /><Info label="Доступно данных" value={`${row.availableFields} полей`} numeric /></dl><div className="mt-7 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900">Рабочие контакты</h3>{row.domain && <button onClick={onEnrich} disabled={enriching} className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface disabled:opacity-50">{enriching ? "Ищем…" : row.hunterEmails.length ? "Обновить через Hunter" : "Найти через Hunter"}</button>}</div><div className="mt-3 space-y-2">{[...new Set([...row.companyEmails, ...row.hunterEmails])].map((email) => { const detail = details.find((item) => item.email === email); return <div key={email} className="rounded-lg border border-line p-3"><div className="text-sm font-medium text-slate-900">{email}</div><div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-500"><span>{row.hunterEmails.includes(email) ? "Hunter" : "Реестр"}</span>{detail?.position && <span>· {detail.position}</span>}{detail?.confidence !== undefined && <span className="metric-number">· уверенность {detail.confidence}%</span>}</div></div>;})}{!row.companyEmails.length && !row.hunterEmails.length && <div className="rounded-lg bg-surface p-4 text-sm text-ink-500">Контактов пока нет. Поиск Hunter расходует кредиты только после вашего нажатия.</div>}</div></aside></div>;
}

function Info({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) { return <div className="rounded-lg border border-line p-3"><dt className="text-xs text-ink-500">{label}</dt><dd className={`mt-1 break-words text-sm font-medium text-slate-900 ${numeric ? "metric-number" : ""}`}>{value}</dd></div>; }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 flex justify-between text-xs font-medium text-ink-700"><span>{label}</span>{hint && <span className="font-normal text-ink-500">{hint}</span>}</span>{children}</label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink-700"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-emerald-700" /></label>; }
function Metric({ value, label, tone }: { value: number; label: string; tone?: boolean }) { return <div className={`rounded-xl border p-4 ${tone ? "border-mint-200 bg-mint-50" : "border-line bg-white"}`}><div className="metric-number text-2xl font-semibold text-slate-900">{value}</div><div className="mt-1 text-xs text-ink-500">{label}</div></div>; }
function Badge({ children, tone }: { children: React.ReactNode; tone?: "green" }) { return <span className={`rounded px-2 py-1 text-[11px] font-medium ${tone ? "bg-mint-100 text-mint-700" : "bg-surface text-ink-700"}`}>{children}</span>; }
function EmptyState({ loading }: { loading: boolean }) { return <div className="flex min-h-[520px] items-center justify-center rounded-xl border border-dashed border-line bg-[#fcfdfc]"><div className="max-w-sm px-6 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-white text-xl text-mint-700 shadow-sm">⌕</div><h2 className="mt-4 text-lg font-semibold text-slate-900">{loading ? "Собираем выборку" : "Начните с портрета компании"}</h2><p className="mt-2 text-sm leading-6 text-ink-500">{loading ? "Проверяем компании, домены и доступные рабочие адреса." : "Укажите отрасль и дополнительные признаки. Результаты появятся здесь — с контактами и источниками."}</p></div></div>; }

function ComparisonDrawer({ filters, onClose }: { filters: Record<string, string | boolean>; onClose: () => void }) {
  const [data, setData] = useState<{ results?: Result[]; error?: string } | null>(null);
  async function run() { setData(null); const query = { limit: Number(filters.limit), filters: { okved: [filters.okved], region: filters.region ? [filters.region] : undefined } }; const response = await fetch("/api/admin/company-data/experiment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checko: { by: "okved", query: filters.okved, obj: "org", active: true, limit: Number(filters.limit) }, datanewton: query, hunterLimitPerDomain: 10 }) }); setData(await response.json()); }
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/25" role="dialog" aria-modal="true" aria-label="Сравнение поставщиков"><button className="absolute inset-0 cursor-default" aria-label="Закрыть" onClick={onClose} /><div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-line bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><div className="text-xs font-medium text-amber-700">Служебное окно</div><h2 className="mt-1 text-xl font-semibold text-slate-900">Сравнение источников</h2><p className="mt-2 text-sm text-ink-500">Одинаковый портрет запускается через Checko и DataNewton, затем оба результата обогащаются Hunter.</p></div><button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm">Закрыть</button></div><button onClick={run} className="btn-primary mt-5 px-4 py-2 text-sm font-semibold">Запустить сравнение</button><div className="mt-5 space-y-3">{data?.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{data.error}</div>}{data?.results?.map((result) => <div key={result.provider} className="rounded-xl border border-line p-4"><div className="flex items-center justify-between"><strong>{result.provider}</strong><span className="metric-number text-xs text-ink-500">{result.usage.company.requests} API</span></div><div className="mt-4 grid grid-cols-3 gap-2"><Metric value={result.summary.companies ?? 0} label="компаний" /><Metric value={result.summary.withHunterEmail ?? 0} label="с email" /><Metric value={result.summary.uniqueHunterEmails ?? 0} label="адресов" /></div></div>)}</div></div></div>;
}
