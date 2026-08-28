"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ContactsImport } from "@/components/ContactsImport";
import { deleteContact, markContactIrrelevant, updateContactPersonalization } from "@/app/(app)/app/contacts/actions";
import type { PublicCompanyFact } from "@/lib/company-data/contactPresentation";

export type ContactWorkspaceItem = {
  id: string; email: string; name: string | null; company: string | null; segment: string | null;
  autoCommunicationName: string | null; communicationNameOverride: string | null; legalCompanyName: string | null;
  role: string | null; source: string; domain: string | null; website: string | null;
  status: string; verificationState: string; verificationScore: number | null;
  relevanceStatus: string; irrelevanceReason: string | null; createdAt: string;
  customFields: Record<string, unknown> | null;
  companyFacts: PublicCompanyFact[];
  siteIntelligence: { summary?: string; facts?: Array<{ category?: string; value?: string }>; personalizationHooks?: Array<{ value?: string } | string> } | null;
};

type Props = { contacts: ContactWorkspaceItem[]; total: number; canManage: boolean };

const EMPTY_CONTACT_FILTERS: Record<string, string> = { source: "", verificationState: "", segment: "" };

export function ContactsWorkspace({ contacts, total, canManage }: Props) {
  const router = useRouter();
  const [importOpen, setImportOpen] = useState(false);
  const [active, setActive] = useState<ContactWorkspaceItem | null>(null);
  const [deleting, setDeleting] = useState<ContactWorkspaceItem | null>(null);
  const [irrelevant, setIrrelevant] = useState<ContactWorkspaceItem | null>(null);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({ ...EMPTY_CONTACT_FILTERS });
  const [draftFilters, setDraftFilters] = useState<Record<string, string>>({ ...EMPTY_CONTACT_FILTERS });

  const fields = useMemo(() => {
    const keys = new Set<string>(["source", "verificationState", "relevanceStatus", "segment", "role", "company"]);
    contacts.forEach((contact) => {
      Object.entries(contact.customFields ?? {}).forEach(([key, value]) => { if (isFacetValue(value)) keys.add(`custom:${key}`); });
      contact.companyFacts.forEach((fact) => keys.add(`company:${fact.key}`));
    });
    return [...keys].map((key) => {
      const values = new Set<string>(); let empty = false;
      contacts.forEach((contact) => { const value = fieldValue(contact, key); value ? values.add(value) : empty = true; });
      return { key, label: fieldLabel(key), values: [...values].sort((a, b) => a.localeCompare(b, "ru")), empty };
    }).filter((field) => field.values.length || field.empty);
  }, [contacts]);

  const visible = useMemo(() => contacts.filter((contact) => Object.entries(filters).every(([key, wanted]) => {
    if (!wanted) return true; const value = fieldValue(contact, key); return wanted === "__empty" ? !value : value === wanted;
  })), [contacts, filters]);

  const activeFilters = useMemo(() => Object.entries(filters).flatMap(([key, value]) => {
    if (!value) return [];
    const field = fields.find((item) => item.key === key);
    return [{ key, label: field?.label ?? fieldLabel(key), value: value === "__empty" ? "Пусто" : fieldOptionLabel(key, value) }];
  }), [fields, filters]);

  const draftHasFilters = Object.values(draftFilters).some(Boolean);
  const filtersChanged = [...new Set([...Object.keys(filters), ...Object.keys(draftFilters)])].some((key) => (filters[key] ?? "") !== (draftFilters[key] ?? ""));

  function resetFilters() {
    setFilters({ ...EMPTY_CONTACT_FILTERS });
    setDraftFilters({ ...EMPTY_CONTACT_FILTERS });
  }

  function applyFilters() {
    setFilters({ ...draftFilters });
    setFiltersOpen(false);
  }

  function mutate(action: (formData: FormData) => Promise<{ ok?: true; error?: string }>, contact: ContactWorkspaceItem, withReason = false) {
    startTransition(async () => {
      const data = new FormData(); data.set("id", contact.id); if (withReason) data.set("reason", reason);
      const result = await action(data); if (result.error) return;
      setDeleting(null); setIrrelevant(null); setActive(null); setReason(""); router.refresh();
    });
  }

  return <>
    <div className="grid gap-3 md:grid-cols-2">
      <button disabled={!canManage} onClick={() => setImportOpen(true)} className="group rounded-2xl border border-line bg-white p-5 text-left transition hover:border-slate-300 hover:bg-[#fcfcfb] disabled:opacity-50">
        <div className="flex items-start justify-between gap-4"><ActionIcon>↑</ActionIcon></div>
        <h2 className="mt-5 text-lg font-semibold text-slate-900">Загрузить свою базу</h2>
        <p className="mt-1.5 text-sm leading-5 text-ink-500">Проверим адреса, сохраним все поля и подготовим данные для персонализации.</p>
      </button>
      <Link href="/app/contacts/discover" className="group rounded-2xl border border-[#173d33] bg-[#173d33] p-5 text-left text-white transition hover:bg-[#12342b]">
        <div className="flex items-start justify-between gap-4"><ActionIcon dark>✦</ActionIcon><span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/75">Рекомендуем</span></div>
        <h2 className="mt-5 text-lg font-semibold">Сформировать базу с AI</h2>
        <p className="mt-1.5 text-sm leading-5 text-white/65">Опишем нужные компании, найдём ЛПР и соберём готовую базу по вашему профилю.</p>
      </Link>
    </div>

    {total > 0 && <>
      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
        <div className="flex min-h-12 items-center gap-2 px-3">
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="contacts-database-filters"
            onClick={() => setFiltersOpen((current) => !current)}
            className="group flex min-w-0 flex-1 items-center gap-2.5 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mint-200"
          >
            <FilterIcon />
            <span className="text-sm font-medium text-slate-900">Фильтры базы</span>
            {activeFilters.length > 0 && <span className="metric-number inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-mint-100 px-1.5 text-[11px] font-semibold text-mint-700">{activeFilters.length}</span>}
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-ink-500 transition group-hover:text-slate-900">
              {filtersOpen ? "Скрыть" : "Показать"}
              <ChevronIcon open={filtersOpen} />
            </span>
          </button>
          {!filtersOpen && activeFilters.length > 0 && <button type="button" onClick={resetFilters} className="shrink-0 rounded-md px-2 py-1.5 text-xs text-ink-500 transition hover:bg-surface hover:text-slate-900">Сбросить</button>}
        </div>

        {!filtersOpen && activeFilters.length > 0 && <div className="flex flex-wrap gap-1.5 border-t border-line bg-[#fafbf9] px-3 py-2.5">
          {activeFilters.map((filter) => <span key={filter.key} className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[11px] text-ink-600"><span className="text-ink-400">{filter.label}:</span><span className="truncate font-medium text-ink-700">{filter.value}</span></span>)}
        </div>}

        {filtersOpen && <div id="contacts-database-filters" className="border-t border-line bg-[#fafbf9] p-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{fields.map((field) => <label key={field.key} className="block"><span className="mb-1 block text-[11px] text-ink-500">{field.label}</span><select className="input !py-2 text-xs" value={draftFilters[field.key] ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Все</option>{field.empty && <option value="__empty">Пусто</option>}{field.values.map((value) => <option key={value} value={value}>{fieldOptionLabel(field.key, value)}</option>)}</select></label>)}</div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
            <button type="button" disabled={!draftHasFilters} onClick={() => setDraftFilters({ ...EMPTY_CONTACT_FILTERS })} className="rounded-lg px-3 py-2 text-xs font-medium text-ink-500 transition hover:bg-white hover:text-slate-900 disabled:pointer-events-none disabled:opacity-40">Очистить</button>
            <button type="button" disabled={!filtersChanged} onClick={applyFilters} className="btn-primary px-4 py-2 text-sm font-semibold disabled:pointer-events-none disabled:opacity-45">Применить фильтры</button>
          </div>
        </div>}
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-4 py-3"><div className="text-sm font-semibold text-slate-900">База контактов</div><div className="metric-number text-xs text-ink-500">{visible.length} из {total}</div></div>
        <div className="scroll-x"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#fafbf9] text-xs text-ink-500"><tr><th className="px-4 py-3 font-medium">Контакт</th><th className="px-4 py-3 font-medium">Компания</th><th className="px-4 py-3 font-medium">Сегмент</th><th className="px-4 py-3 font-medium">Источник</th><th className="px-4 py-3 font-medium">Проверка</th></tr></thead><tbody>{visible.map((contact) => <tr key={contact.id} onClick={() => setActive(contact)} className="cursor-pointer border-t border-line transition hover:bg-[#fbfcfb]"><td className="px-4 py-3"><div className="font-medium text-slate-900">{contact.email}</div><div className="mt-0.5 text-xs text-ink-500">{contact.name || contact.role || <Placeholder>Имя не найдено</Placeholder>}</div></td><td className="px-4 py-3 text-ink-700">{contact.company || <Placeholder>Название не найдено</Placeholder>}</td><td className="px-4 py-3 text-ink-700">{contact.segment && contact.segment !== "Сегмент не определён" ? contact.segment : <Placeholder>Сегмент не определён</Placeholder>}</td><td className="px-4 py-3"><Badge>{contact.source === "AI_SEARCH" ? "Наш поиск" : "База пользователя"}</Badge></td><td className="px-4 py-3"><VerificationBadge state={contact.verificationState} /></td></tr>)}</tbody></table></div>
      </div>
    </>}

    {importOpen && <Modal title="Загрузить свою базу" onClose={() => setImportOpen(false)} wide><ContactsImport compact onDone={() => { setImportOpen(false); router.refresh(); }} /></Modal>}
    {active && <ContactDrawer contact={active} canManage={canManage} onClose={() => setActive(null)} onDelete={() => setDeleting(active)} onIrrelevant={() => setIrrelevant(active)} />}
    {deleting && <Modal title="Удалить контакт?" onClose={() => setDeleting(null)}><p className="text-sm leading-6 text-ink-600">{deleting.email} исчезнет из базы и кампаний. Уже использованный месячный лимит не изменится.</p><div className="mt-5 flex justify-end gap-2"><button onClick={() => setDeleting(null)} className="rounded-lg border border-line px-4 py-2 text-sm">Отмена</button><button disabled={pending} onClick={() => mutate(deleteContact, deleting)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">Удалить</button></div></Modal>}
    {irrelevant && <Modal title="Почему компания не подходит?" onClose={() => setIrrelevant(null)}><p className="text-sm leading-6 text-ink-500">Комментарий поможет точнее отбирать компании в следующих поисках. Он не будет использоваться как запрет на тип адреса.</p><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="input mt-4 min-h-24" placeholder="Например: работает только с физлицами" /><div className="mt-5 flex justify-end gap-2"><button onClick={() => setIrrelevant(null)} className="rounded-lg border border-line px-4 py-2 text-sm">Отмена</button><button disabled={pending} onClick={() => mutate(markContactIrrelevant, irrelevant, true)} className="btn-primary px-4 py-2 text-sm font-semibold">Пометить</button></div></Modal>}
  </>;
}

function ContactDrawer({ contact, canManage, onClose, onDelete, onIrrelevant }: { contact: ContactWorkspaceItem; canManage: boolean; onClose: () => void; onDelete: () => void; onIrrelevant: () => void }) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [name, setName] = useState(contact.name ?? "");
  const [companyName, setCompanyName] = useState(contact.company ?? "");
  const [companyOverride, setCompanyOverride] = useState(contact.communicationNameOverride);
  const [saveState, setSaveState] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const website = contact.website || (contact.domain ? `https://${contact.domain}` : null);
  const details = [
    { label: "Email", value: contact.email },
    { label: "Роль", value: contact.role, empty: "Роль не определена" },
    { label: "Название в исходных данных", value: contact.legalCompanyName, empty: "Не найдено" },
    { label: "Сегмент", value: contact.segment === "Сегмент не определён" ? null : contact.segment, empty: "Сегмент не определён" },
    ...Object.entries(contact.customFields ?? {}).map(([label, value]) => ({ label, value: stringify(value), empty: "Не заполнено" })),
    ...contact.companyFacts.map((fact) => ({ label: fact.label, value: fact.value, empty: "Не заполнено" })),
  ];
  function savePersonalization() {
    startSaving(async () => {
      const data = new FormData();
      data.set("id", contact.id); data.set("name", name); data.set("companyName", companyName);
      const result = await updateContactPersonalization(data);
      if (!result.ok) return setSaveState({ tone: "error", text: `${result.error ?? "Не удалось сохранить"}${result.code ? ` Код: ${result.code}` : ""}` });
      setName(result.name ?? ""); setCompanyName(result.company ?? ""); setCompanyOverride(result.communicationNameOverride ?? null);
      setSaveState({ tone: "ok", text: "Сохранено" }); router.refresh();
    });
  }
  return <div className="fixed inset-0 z-40 flex justify-end bg-black/20" role="dialog" aria-modal="true"><button className="absolute inset-0" aria-label="Закрыть" onClick={onClose} /><aside className="relative h-full w-full max-w-lg overflow-y-auto border-l border-line bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><div className="text-xs text-ink-500">Карточка контакта</div><h2 className="mt-1 break-all text-xl font-semibold text-slate-900">{contact.email}</h2></div><button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm">Закрыть</button></div><div className="mt-5 flex flex-wrap gap-2"><Badge>{contact.source === "AI_SEARCH" ? "Наш поиск" : "База пользователя"}</Badge><VerificationBadge state={contact.verificationState} />{contact.relevanceStatus === "IRRELEVANT" && <Badge>Нерелевантен</Badge>}</div>{canManage && <section className="mt-6 rounded-xl border border-line bg-[#fafbff] p-4"><div><h3 className="text-sm font-semibold text-slate-900">Данные для письма</h3><p className="mt-1 text-xs leading-5 text-ink-500">Если поле пустое, письмо будет написано без имени или названия компании.</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label><span className="mb-1 block text-xs text-ink-500">Имя получателя</span><input className="input !py-2 text-sm" value={name} onChange={(event) => { setName(event.target.value); setSaveState(null); }} placeholder="Не найдено" /></label><label><span className="mb-1 block text-xs text-ink-500">Название для писем</span><input className="input !py-2 text-sm" value={companyName} onChange={(event) => { setCompanyName(event.target.value); setCompanyOverride(event.target.value === contact.autoCommunicationName ? null : event.target.value); setSaveState(null); }} placeholder="Не найдено" />{companyOverride !== null && contact.autoCommunicationName && <button type="button" onClick={() => { setCompanyName(contact.autoCommunicationName ?? ""); setCompanyOverride(null); setSaveState(null); }} className="mt-1.5 text-[11px] font-medium text-mint-700 hover:underline">Вернуть найденное название</button>}</label></div><div className="mt-3 flex items-center justify-between gap-3">{saveState ? <span className={`text-xs ${saveState.tone === "ok" ? "text-mint-700" : "text-red-700"}`}>{saveState.text}</span> : <span /> }<button type="button" onClick={savePersonalization} disabled={saving} className="btn-primary px-3.5 py-2 text-xs font-semibold disabled:opacity-50">{saving ? "Сохраняем…" : "Сохранить"}</button></div></section>}<dl className="mt-6 grid gap-3 sm:grid-cols-2">{details.map((item) => <div key={item.label} className="rounded-lg border border-line p-3"><dt className="text-xs text-ink-500">{item.label}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-900">{item.value || <Placeholder>{item.empty}</Placeholder>}</dd></div>)}<div className="rounded-lg border border-line p-3"><dt className="text-xs text-ink-500">Сайт</dt><dd className="mt-1 break-words text-sm font-medium text-slate-900">{website ? <a href={website} target="_blank" rel="noreferrer" className="text-mint-700 hover:underline">{contact.domain || contact.website}</a> : <Placeholder>Сайт не найден</Placeholder>}</dd></div></dl>{contact.siteIntelligence?.summary && <section className="mt-6 rounded-xl border border-line bg-[#fafbf9] p-4"><h3 className="text-sm font-semibold text-slate-900">Что знаем о компании</h3><p className="mt-2 text-sm leading-6 text-ink-600">{contact.siteIntelligence.summary}</p></section>}{canManage && <div className="mt-7 flex flex-wrap gap-2 border-t border-line pt-5"><button onClick={onIrrelevant} className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-800">Пометить как нерелевантного</button><button onClick={onDelete} className="rounded-lg border border-red-200 px-3.5 py-2 text-sm font-medium text-red-700">Удалить</button></div>}</aside></div>;
}

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" role="dialog" aria-modal="true"><button className="absolute inset-0" aria-label="Закрыть" onClick={onClose} /><div className={`relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-2xl ${wide ? "max-w-3xl" : "max-w-md"}`}><div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold text-slate-900">{title}</h2><button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm">Закрыть</button></div>{children}</div></div>; }
function ActionIcon({ children, dark }: { children: React.ReactNode; dark?: boolean }) { return <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${dark ? "bg-white/10 text-white" : "border border-line bg-surface text-mint-700"}`}>{children}</span>; }
function FilterIcon() { return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-600 transition group-hover:text-slate-900"><svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 5.25h13M5.75 10h8.5M8 14.75h4" /></svg></span>; }
function ChevronIcon({ open }: { open: boolean }) { return <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3.5 w-3.5 fill-none stroke-current transition-transform ${open ? "rotate-180" : ""}`} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m4 6 4 4 4-4" /></svg>; }
function Badge({ children }: { children: React.ReactNode }) { return <span className="inline-flex rounded-md bg-surface px-2 py-1 text-[11px] font-medium text-ink-700">{children}</span>; }
function VerificationBadge({ state }: { state: string }) { const invalid = ["INVALID", "DISPOSABLE", "BLOCKED"].includes(state); const verified = state === "VALID" || state === "ACCEPT_ALL"; return <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-medium ${invalid ? "bg-red-50 text-red-700" : verified ? "bg-mint-100 text-mint-700" : "bg-surface text-ink-600"}`}>{invalid ? "Не работает" : verified ? "Проверен" : "Проверяется"}</span>; }
function Placeholder({ children }: { children: React.ReactNode }) { return <span className="inline-flex rounded-md border border-dashed border-line bg-[#fafbf9] px-2 py-0.5 text-[11px] font-normal italic text-ink-400">{children}</span>; }
function fieldValue(contact: ContactWorkspaceItem, key: string) { if (key.startsWith("custom:")) return stringify(contact.customFields?.[key.slice(7)]); if (key.startsWith("company:")) return contact.companyFacts.find((fact) => fact.key === key.slice(8))?.value ?? ""; if (key === "verificationState") return contact.verificationState === "ACCEPT_ALL" ? "VALID" : contact.verificationState; const value = contact[key as keyof ContactWorkspaceItem]; return typeof value === "string" ? value : value == null ? "" : stringify(value); }
function fieldLabel(key: string) { const companyLabels: Record<string, string> = { inn: "ИНН", activity: "Вид деятельности", okved: "ОКВЭД", region: "Регион", leader: "Руководитель", employees: "Сотрудники", revenue: "Выручка" }; return ({ source: "Источник", verificationState: "Проверка email", relevanceStatus: "Релевантность", segment: "Сегмент", role: "Роль", company: "Компания" } as Record<string, string>)[key] ?? (key.startsWith("company:") ? companyLabels[key.slice(8)] ?? "Данные компании" : key.replace(/^custom:/, "")); }
function fieldOptionLabel(key: string, value: string) { if (key === "source") return value === "AI_SEARCH" ? "Наш поиск" : value === "USER_UPLOAD" ? "База пользователя" : value; if (key === "relevanceStatus") return value === "IRRELEVANT" ? "Нерелевантен" : "Релевантен"; if (key === "verificationState") return ({ VALID: "Проверен", INVALID: "Не работает", UNVERIFIED: "Не проверен", UNKNOWN: "Проверяется", PENDING: "Проверяется" } as Record<string, string>)[value] ?? value; return value; }
function stringify(value: unknown) { if (value == null) return ""; if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value); try { return JSON.stringify(value); } catch { return ""; } }
function isFacetValue(value: unknown) { return value == null || ["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) && value.length <= 10 && value.every((item) => ["string", "number", "boolean"].includes(typeof item))); }
