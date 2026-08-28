"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { dataNewtonOpfCodes, LEGAL_FORM_OPTIONS, normalizeProspectingRoles, PROSPECTING_ROLE_OPTIONS } from "@/lib/company-data/prospectingCatalog";
import { estimateProspectingTime, formatElapsedTime, formatProspectingEstimate } from "@/lib/company-data/prospectingTiming";
import { availableSearchCredits, estimateProspectingBudget, hasReliableConversion, prospectingCriteriaFingerprint, safeDeepSearchCredits, SEARCH_CREDITS_PER_COMPANY, type DeepSearchRiskAssessment, type ProspectingBudgetEstimate, type ProspectingSearchMode } from "@/lib/company-data/searchBudget";
import { normalizeRegionCodes } from "@/lib/company-data/regionCodes";
import { effectiveCommunicationName } from "@/lib/mail/recipientPersonalization";
import { DeepSearchConsentDialog, SearchLimitCard } from "@/components/SearchLimitCard";

type Okved = { code: string; description: string };
type OkvedTreeNode = {
  id: string; kind: "section" | "code"; section: string; description: string;
  code?: string; sectionDescription?: string; hasChildren: boolean;
};
type SuggestedFilters = {
  summary: string; segment: string; okveds: Okved[]; regions: string[]; desiredRoles: string[];
  revenueFrom?: number; revenueTo?: number; employeesFrom?: number; employeesTo?: number;
};
type CollectedContact = {
  company: { displayName: string | null; legalName: string | null; communicationName: string | null; communicationNameConfidence: number | null; inn: string | null };
  contact: { email: string; name: string | null; role: string | null; kind: string; source: string; verificationState: string };
};
type CollectionRun = {
  id: string; status: string; targetContacts: number; maxCandidates: number; processedCount?: number;
  acceptedCount?: number; error?: string | null; completionReason?: string | null; contacts?: CollectedContact[];
  searchSummary?: string; createdAt?: string | Date; startedAt?: string | Date | null; completedAt?: string | Date | null;
  issueCount?: number; latestIssueCode?: string | null;
  searchMode?: ProspectingSearchMode; budgetEstimate?: ProspectingBudgetEstimate; safeDeepStage?: boolean;
  criteria?: SavedCriteria;
};
type SavedCriteria = {
  description: string; okveds: Okved[]; region: string; legalForms: string[]; desiredRoles: string[];
  keywords: string; excludeCompanyTraits: string; onlyActive: boolean; segment: string; searchMode: ProspectingSearchMode;
};
type DeepLimitPrompt = { assessment: DeepSearchRiskAssessment; summary: string };
type FilterState = {
  region: string; legalForms: string[]; desiredRoles: string[]; keywords: string; excludeCompanyTraits: string;
  onlyActive: boolean;
};
type FilterSectionKey = "okveds" | "regions" | "legalForms" | "roles" | "status" | "segment";

const initialFilters: FilterState = {
  region: "", legalForms: [], desiredRoles: [], keywords: "", excludeCompanyTraits: "",
  onlyActive: true,
};

export function ProspectingWorkspace({ initialRun, isAdmin, canManage, quota, searchBudget, profilePublished, defaultTargetContacts, isTrial, planExpiresAt }: {
  initialRun?: CollectionRun | null; isAdmin: boolean; canManage: boolean;
  quota: { used: number; limit: number; remaining: number };
  searchBudget: { used: number; limit: number; remaining: number; deepUsed: number; history: Record<ProspectingSearchMode, { processed: number; accepted: number }>; historyByCriteria: Record<string, { processed: number; accepted: number }> };
  profilePublished: boolean; defaultTargetContacts?: number; isTrial: boolean; planExpiresAt?: string | null;
}) {
  const router = useRouter();
  const savedCriteria = initialRun?.criteria;
  const [filters, setFilters] = useState<FilterState>(() => savedCriteria ? {
    region: savedCriteria.region, legalForms: savedCriteria.legalForms, desiredRoles: savedCriteria.desiredRoles,
    keywords: savedCriteria.keywords, excludeCompanyTraits: savedCriteria.excludeCompanyTraits, onlyActive: savedCriteria.onlyActive,
  } : initialFilters);
  const [okveds, setOkveds] = useState<Okved[]>(savedCriteria?.okveds ?? []);
  const [aiQuery, setAiQuery] = useState(savedCriteria?.description ?? "");
  const [segment, setSegment] = useState(savedCriteria?.segment ?? "Сегмент не определён");
  const [targetContacts, setTargetContacts] = useState(defaultTargetContacts ? String(defaultTargetContacts) : initialRun ? String(initialRun.targetContacts) : "");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [draftRun, setDraftRun] = useState<CollectionRun | null>(null);
  const [activeRun, setActiveRun] = useState<CollectionRun | null>(initialRun ?? null);
  const [pollIssue, setPollIssue] = useState("");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [okvedPickerOpen, setOkvedPickerOpen] = useState(false);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<ProspectingSearchMode>(savedCriteria?.searchMode ?? initialRun?.searchMode ?? "standard");
  const [restoredFiltersNotice, setRestoredFiltersNotice] = useState(false);
  const [deepLimitPrompt, setDeepLimitPrompt] = useState<DeepLimitPrompt | null>(null);
  const [openFilters, setOpenFilters] = useState<Record<FilterSectionKey, boolean>>({
    okveds: false, regions: false, legalForms: false, roles: false, status: false, segment: false,
  });
  const requestedContactsValue = optionalPositiveInteger(targetContacts);
  const requestedContacts = requestedContactsValue ?? 1;
  const deepCriteriaMissing = searchMode === "deep" && !filters.keywords.trim() && !filters.excludeCompanyTraits.trim();
  const criteriaFingerprint = prospectingCriteriaFingerprint({ ...buildQuery(), search_mode: searchMode });
  const currentModeHistory = searchMode === "deep"
    ? searchBudget.historyByCriteria[criteriaFingerprint]
    : searchBudget.history.standard;
  const availableCredits = availableSearchCredits({ mode: searchMode, limit: searchBudget.limit, used: searchBudget.used, deepUsed: searchBudget.deepUsed });
  const unrestrictedBudgetEstimate = estimateProspectingBudget({
    mode: searchMode,
    targetContacts: requestedContacts,
    availableCredits,
    history: currentModeHistory,
    standardHistory: searchBudget.history.standard,
  });
  const safeDeepAllowance = searchMode === "deep" ? safeDeepSearchCredits({
    limit: searchBudget.limit,
    remainingCredits: searchBudget.remaining,
    deepUsed: searchBudget.deepUsed,
    remainingContacts: quota.remaining,
    standardHistory: searchBudget.history.standard,
  }) : 0;
  const safeDeepStage = searchMode === "deep"
    && unrestrictedBudgetEstimate.plannedCredits > safeDeepAllowance
    && safeDeepAllowance >= SEARCH_CREDITS_PER_COMPANY.deep;
  const budgetEstimate = safeDeepStage ? estimateProspectingBudget({
    mode: "deep",
    targetContacts: requestedContacts,
    availableCredits,
    modeCreditCap: safeDeepAllowance,
    history: currentModeHistory,
    standardHistory: searchBudget.history.standard,
  }) : unrestrictedBudgetEstimate;
  const capacityEstimate = estimateProspectingBudget({
    mode: searchMode,
    targetContacts: Math.max(1, quota.remaining),
    availableCredits,
    history: currentModeHistory,
    standardHistory: searchBudget.history.standard,
  });
  const forecastReliable = searchMode === "standard" || hasReliableConversion(currentModeHistory);
  const estimatedContactCapacity = Math.min(quota.remaining, capacityEstimate.expectedContacts);
  const standardAvailableCredits = availableSearchCredits({ mode: "standard", limit: searchBudget.limit, used: searchBudget.used, deepUsed: searchBudget.deepUsed });
  const standardCapacityEstimate = estimateProspectingBudget({
    mode: "standard",
    targetContacts: Math.max(1, quota.remaining),
    availableCredits: standardAvailableCredits,
    history: searchBudget.history.standard,
    standardHistory: searchBudget.history.standard,
  });
  const estimatedStandardContactCapacity = Math.min(quota.remaining, standardCapacityEstimate.expectedContacts);
  const warningCapacity = forecastReliable ? estimatedContactCapacity : quota.remaining;
  const targetLikelyTooHigh = Boolean(requestedContactsValue && requestedContactsValue > warningCapacity);

  useEffect(() => {
    if (!activeRun || !["QUEUED", "RUNNING"].includes(activeRun.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/company-data/prospecting-runs/${activeRun.id}`);
        if (!response.ok) throw new Error("status_unavailable");
        const body = await response.json();
        setActiveRun(body.run); setPollIssue("");
        if (!["QUEUED", "RUNNING"].includes(body.run?.status)) router.refresh();
      } catch {
        setPollIssue("Не удалось обновить данные на экране. Сам подбор продолжает работать — попробуем снова автоматически. Код: SRC-2003");
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeRun?.id, activeRun?.status, router]);

  async function askAi(description = aiQuery, apply = true) {
    setLoading(true); setNotice("");
    try {
      const response = await fetch("/api/company-data/filter-assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description, includeProfile: true }) });
      const body = await response.json(); if (!response.ok) throw new Error(apiError(body, "Не удалось подобрать критерии"));
      const suggestion = body.suggestion as SuggestedFilters;
      if (apply) applySuggestion(suggestion);
      return suggestion;
    } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось подобрать критерии"); return null; }
    finally { setLoading(false); }
  }

  function applySuggestion(suggestion: SuggestedFilters) {
    setOkveds(suggestion.okveds);
    setSegment(suggestion.segment || "Сегмент не определён");
    setFilters((current) => ({
      ...current, region: normalizeRegionCodes(suggestion.regions).join(", "), desiredRoles: normalizeProspectingRoles(suggestion.desiredRoles),
    }));
    setOpenFilters((current) => ({
      ...current,
      okveds: suggestion.okveds.length > 0,
      regions: suggestion.regions.length > 0,
      roles: suggestion.desiredRoles.length > 0,
      segment: Boolean(suggestion.segment),
    }));
    setNotice(suggestion.okveds.length
      ? "Критерии заполнены. Проверьте их перед запуском."
      : "Не удалось однозначно определить отрасль получателей. Уточните в описании, чем занимаются нужные компании.");
  }

  async function fillDescriptionFromProfile() {
    const suggestion = await askAi("", false);
    if (!suggestion) return;
    setAiQuery(suggestion.summary);
    setNotice("Описание подготовлено из профиля. Дополните его при необходимости и нажмите «Подобрать ОКВЭДы и фильтры».");
  }

  async function prepareCollection(deepLimitConsent = false, preparedSummary?: string) {
    if (!okveds.length) { setNotice("Добавьте хотя бы один ОКВЭД — можно описать нужные компании обычными словами."); return; }
    if (searchMode === "deep" && !filters.keywords.trim() && !filters.excludeCompanyTraits.trim()) {
      setNotice("Добавьте хотя бы один критерий для проверки по сайту или вернитесь к обычному поиску."); return;
    }
    const requestedContacts = optionalPositiveInteger(targetContacts);
    if (!requestedContacts || requestedContacts < 1) {
      setNotice("Укажите, сколько контактов нужно найти."); return;
    }
    setLoading(true); setNotice("");
    try {
      const summarySuggestion = preparedSummary ? null : await askAi(buildDescription(), false);
      const searchSummary = preparedSummary || summarySuggestion?.summary || fallbackSummary();
      const response = await fetch("/api/company-data/prospecting-runs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: buildQuery(), targetContacts: requestedContacts, searchMode, deepLimitConsent }),
      });
      const body = await response.json(); if (!response.ok) throw new Error(apiError(body, "Не удалось подготовить поиск"));
      if (body.requiresDeepLimitConsent && body.searchLimit) {
        setDeepLimitPrompt({ assessment: body.searchLimit, summary: searchSummary });
        return;
      }
      if (!body.run) throw new Error("Не удалось подготовить поиск. Код: SRC-2012");
      setDeepLimitPrompt(null);
      setDraftRun({ ...body.run, searchMode, budgetEstimate: body.estimate, safeDeepStage: Boolean(body.safeDeepStage), searchSummary });
    } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось подготовить поиск"); }
    finally { setLoading(false); }
  }

  async function confirmCollection() {
    if (!draftRun) return;
    setLoading(true); setNotice("");
    try {
      const response = await fetch(`/api/company-data/prospecting-runs/${draftRun.id}/queue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
      const body = await response.json(); if (!response.ok) throw new Error(apiError(body, "Не удалось запустить поиск"));
      setActiveRun({ ...body.run, searchMode: draftRun.searchMode, safeDeepStage: draftRun.safeDeepStage }); setDraftRun(null); setNotice("Поиск запущен. Готовые контакты будут появляться в вашей базе автоматически.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось запустить поиск"); }
    finally { setLoading(false); }
  }

  function startNewSearch() {
    setActiveRun(null);
    setDraftRun(null);
    setNotice("");
    setRestoredFiltersNotice(true);
  }

  function resetSearchFilters() {
    setFilters({ ...initialFilters });
    setOkveds([]);
    setAiQuery("");
    setSegment("Сегмент не определён");
    setTargetContacts("");
    setSearchMode("standard");
    setOpenFilters({ okveds: false, regions: false, legalForms: false, roles: false, status: false, segment: false });
    setDraftRun(null);
    setDeepLimitPrompt(null);
    setNotice("");
    setRestoredFiltersNotice(false);
  }

  function buildQuery() {
    const standard = {
      okveds: okveds.map((item) => item.code), region_codes: normalizeRegionCodes(split(filters.region)),
      opf_codes: filters.legalForms.length ? dataNewtonOpfCodes(filters.legalForms) : undefined,
      legal_forms: filters.legalForms.length ? filters.legalForms : undefined,
      desired_roles: filters.desiredRoles.length ? filters.desiredRoles : undefined,
      only_active: filters.onlyActive, only_with_emails: true, segment,
      search_description: aiQuery.trim() || undefined,
      okved_labels: okveds.map((item) => ({ code: item.code, description: item.description })),
    };
    if (searchMode === "standard") return standard;
    return {
      ...standard,
      keywords: split(filters.keywords), exclude_company_traits: split(filters.excludeCompanyTraits),
      only_with_websites: true,
    };
  }
  function buildDescription() { return [aiQuery, `ОКВЭД: ${okveds.map((item) => `${item.code} ${item.description}`).join("; ")}`, `Регионы: ${filters.region || "любые"}`, `Желаемые ЛПР: ${filters.desiredRoles.join(", ") || "любые руководители"}`, searchMode === "deep" && filters.keywords && `Обязательные критерии: ${filters.keywords}`, searchMode === "deep" && filters.excludeCompanyTraits && `Кого не ищем: ${filters.excludeCompanyTraits}`].filter(Boolean).join("\n"); }
  function fallbackSummary() { return `Ищем действующие компании по ОКВЭД ${okveds.map((item) => item.code).join(", ")}${filters.region ? ` в регионах: ${filters.region}` : " по всей России"}. Приоритетные роли: ${filters.desiredRoles.join(", ") || "руководители компании"}.`; }

  return <div className="mx-auto max-w-[1440px]">
    <div className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-medium text-ink-500"><Link href="/app/contacts" className="hover:text-slate-900">Контакты</Link><span>/</span><span>AI-поиск</span></div><h1 className="text-[30px] font-semibold leading-tight text-slate-900">Сформировать базу с AI</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-ink-500">Опишите нужные компании, проверьте предложенный портрет и запустите сбор. Найдём несколько релевантных контактов в каждой компании.</p></div>
      <div className="flex gap-2">{activeRun && <button type="button" onClick={startNewSearch} className="rounded-lg bg-mint-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-mint-800">Новый поиск</button>}{isAdmin && <button onClick={() => setComparisonOpen(true)} className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink-700 hover:bg-surface">Сравнить источники</button>}<Link href="/app/contacts" className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink-700 hover:bg-surface">Моя база</Link></div>
    </div>

    <SearchLimitCard budget={searchBudget} mode={searchMode} estimatedContactCapacity={searchMode === "deep" && forecastReliable ? estimatedContactCapacity : estimatedStandardContactCapacity} forecastReliable={forecastReliable} isTrial={isTrial} renewsAt={planExpiresAt} />

    {restoredFiltersNotice && <div className="mt-4 rounded-lg border border-mint-200 bg-mint-50 px-4 py-3 text-sm text-mint-800">Параметры предыдущего поиска сохранены. Проверьте их перед новым запуском.</div>}
    <div className={`mt-6 grid min-w-0 gap-5 ${activeRun ? "grid-cols-1" : "xl:grid-cols-[360px_minmax(0,1fr)]"}`}>
      {!activeRun && <aside className="h-fit rounded-xl border border-line bg-[#fafbf9] p-4 xl:sticky xl:top-6">
        <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-900">Критерии поиска</h2><button type="button" onClick={resetSearchFilters} className="rounded-md px-2 py-1 text-xs font-medium text-ink-500 transition hover:bg-white hover:text-slate-900">Сбросить фильтры</button></div>
        <div className={`mt-4 rounded-xl border-2 bg-white p-4 ${targetLikelyTooHigh ? "border-amber-300" : "border-mint-300"}`}>
          <label htmlFor="prospecting-target" className="text-sm font-semibold text-slate-900">Сколько контактов найти</label>
          <input id="prospecting-target" type="number" min={1} inputMode="numeric" className="input metric-number mt-2 !py-3 text-xl font-semibold" value={targetContacts} onChange={(event) => setTargetContacts(event.target.value)} placeholder="Например, 250" />
          {targetLikelyTooHigh && <p className="mt-2 text-[11px] leading-4 text-amber-700">При текущем остатке лимита сможем найти ориентировочно до <span className="metric-number font-semibold">{warningCapacity.toLocaleString("ru-RU")}</span> контактов.</p>}
        </div>
        <div className="mt-4 rounded-xl border border-line bg-white p-3"><div className="mb-1.5 flex items-center justify-between gap-3"><label htmlFor="prospecting-description" className="text-xs font-medium text-ink-700">Какие компании нужны</label>{profilePublished ? <button type="button" onClick={fillDescriptionFromProfile} disabled={loading} className="shrink-0 rounded-md border border-mint-200 bg-mint-50 px-2 py-1 text-[11px] font-semibold text-mint-800 hover:bg-mint-100 disabled:opacity-50">✦ Из профиля</button> : <Link href="/app/settings/profile" className="shrink-0 text-[11px] font-medium text-mint-700 hover:text-mint-900">Опубликовать профиль</Link>}</div><textarea id="prospecting-description" className="input min-h-20 resize-y" value={aiQuery} onChange={(event) => setAiQuery(event.target.value)} placeholder="Например: небольшие юридические компании Москвы, которые работают с бизнесом" /><button onClick={() => askAi(aiQuery, true)} disabled={loading || !aiQuery.trim()} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-700 hover:bg-surface disabled:opacity-40">Подобрать ОКВЭДы и фильтры</button></div>
        <div className="mt-4 space-y-2">
          <FilterAccordion title="ОКВЭДы" count={okveds.length} open={openFilters.okveds} onToggle={() => setOpenFilters((current) => ({ ...current, okveds: !current.okveds }))} summary={okveds.slice(0, 2).map((item) => item.code).join(", ")}>
            <div className="flex items-center justify-between gap-2"><span className="text-[11px] text-ink-500">Виды деятельности</span><div className="flex items-center gap-2"><button type="button" onClick={() => setOkvedPickerOpen(true)} className="text-[11px] font-medium text-mint-700 hover:text-mint-900">Выбрать вручную</button>{okveds.length > 0 && <button type="button" onClick={() => setOkveds([])} className="text-[11px] text-ink-500">Очистить</button>}</div></div>
            <div className="mt-2 flex flex-wrap gap-1.5">{okveds.length ? okveds.map((item) => <button type="button" key={item.code} title={item.description} onClick={() => setOkveds((current) => current.filter((value) => value.code !== item.code))} className="metric-number rounded-md border border-line bg-white px-2 py-1 text-xs text-ink-700 hover:border-red-200">{item.code} <span className="ml-1 text-ink-400">×</span></button>) : <span className="text-xs text-ink-500">Подберите через AI или откройте справочник</span>}</div>
            {okveds.length > 0 && <p className="mt-1.5 text-[11px] leading-4 text-ink-500">Наведите на код, чтобы увидеть полную расшифровку.</p>}
          </FilterAccordion>
          <FilterAccordion title="Регионы" count={normalizeRegionCodes(split(filters.region)).length} open={openFilters.regions} onToggle={() => setOpenFilters((current) => ({ ...current, regions: !current.regions }))} summary={filters.region}>
            <Field label="Коды регионов"><input className="input metric-number" placeholder="77, 78, 50" value={filters.region} onChange={(event) => setFilters({ ...filters, region: event.target.value })} /><span className="mt-1.5 block text-[11px] leading-4 text-ink-500">Например: <span className="metric-number">77</span> — Москва, <span className="metric-number">78</span> — Санкт-Петербург.</span></Field>
          </FilterAccordion>
          <FilterAccordion title="Организационная форма" count={filters.legalForms.length} open={openFilters.legalForms} onToggle={() => setOpenFilters((current) => ({ ...current, legalForms: !current.legalForms }))} summary={filters.legalForms.map((value) => LEGAL_FORM_OPTIONS.find((option) => option.value === value)?.label).filter(Boolean).join(", ")}>
            <div className="grid grid-cols-2 gap-1.5">{LEGAL_FORM_OPTIONS.map((option) => { const selected = filters.legalForms.includes(option.value); return <button type="button" key={option.value} title={option.description} aria-pressed={selected} onClick={() => setFilters({ ...filters, legalForms: selected ? filters.legalForms.filter((item) => item !== option.value) : [...filters.legalForms, option.value] })} className={`rounded-lg border px-2.5 py-2 text-left text-xs ${selected ? "border-mint-300 bg-mint-50 font-medium text-mint-800" : "border-line bg-white text-ink-600 hover:bg-surface"}`}>{option.label}</button>; })}</div><p className="mt-1.5 text-[11px] leading-4 text-ink-500">ИП можно искать отдельно или вместе с организациями.</p>
          </FilterAccordion>
          <FilterAccordion title="Желаемые ЛПР" count={filters.desiredRoles.length} open={openFilters.roles} onToggle={() => setOpenFilters((current) => ({ ...current, roles: !current.roles }))} summary={filters.desiredRoles.slice(0, 2).join(", ")}>
            <button type="button" onClick={() => setRolePickerOpen(true)} className="text-[11px] font-medium text-mint-700 hover:text-mint-900">Выбрать роли</button><div className="mt-2 flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white p-2">{filters.desiredRoles.length ? filters.desiredRoles.map((role) => <button type="button" key={role} title="Убрать из приоритета" onClick={() => setFilters({ ...filters, desiredRoles: filters.desiredRoles.filter((item) => item !== role) })} className="rounded-md bg-surface px-2 py-1 text-xs text-ink-700">{role} <span className="text-ink-400">×</span></button>) : <span className="text-xs text-ink-500">Любые подходящие руководители</span>}</div><p className="mt-1.5 text-[11px] leading-4 text-ink-500">Это приоритет поиска и сортировки, а не запрет на другие полезные контакты.</p>
          </FilterAccordion>
          <FilterAccordion title="Статус компании" count={filters.onlyActive ? 1 : 0} open={openFilters.status} onToggle={() => setOpenFilters((current) => ({ ...current, status: !current.status }))} summary={filters.onlyActive ? "Только действующие" : "Любой статус"}>
            <Toggle label="Только действующие" checked={filters.onlyActive} onChange={(value) => setFilters({ ...filters, onlyActive: value })} />
          </FilterAccordion>
          <details className={`rounded-xl border bg-white ${searchMode === "deep" ? "border-mint-300 ring-1 ring-mint-100" : "border-line"}`} open={searchMode === "deep"}>
            <summary className="cursor-pointer list-none p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-semibold text-slate-900">Глубокий поиск по сайту</div><p className="mt-1 text-[11px] leading-4 text-ink-500">Для критериев, которых нет в реестре. Контактов может быть меньше, чем при обычном поиске.</p></div><span className={`mt-0.5 rounded-full px-2 py-1 text-[10px] font-medium ${searchMode === "deep" ? "bg-mint-100 text-mint-800" : "bg-surface text-ink-500"}`}>{searchMode === "deep" ? "Включён" : "Необязательно"}</span></div></summary>
            <div className="border-t border-line p-3"><button type="button" onClick={() => setSearchMode((current) => current === "deep" ? "standard" : "deep")} className={`w-full rounded-lg border px-3 py-2 text-sm font-medium ${searchMode === "deep" ? "border-slate-300 bg-slate-900 text-white" : "border-line text-ink-700 hover:bg-surface"}`}>{searchMode === "deep" ? "Вернуться к обычному поиску" : "Включить глубокий поиск"}</button>{searchMode === "deep" && <div className="mt-4 space-y-3">{!forecastReliable && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-4 text-amber-800">При глубоком поиске лимиты расходуются быстрее. Рекомендуем начать с тестового поиска до <span className="metric-number font-semibold">30</span> контактов.</div>}<div><Field label="Обязательные критерии"><input className="input" value={filters.keywords} onChange={(event) => setFilters({ ...filters, keywords: event.target.value })} placeholder="Например: работает с тендерами" /></Field><p className="mt-1.5 text-[11px] leading-4 text-ink-500">Подтверждаем это по сайту компании.</p></div><Field label="Кого не ищем"><textarea className="input min-h-16" value={filters.excludeCompanyTraits} onChange={(event) => setFilters({ ...filters, excludeCompanyTraits: event.target.value })} placeholder="Например: работает только с физлицами" /></Field>{forecastReliable && <p className="text-[11px] leading-4 text-ink-500">По накопленной статистике текущего лимита хватит примерно на <span className="metric-number font-semibold text-ink-700">{estimatedContactCapacity.toLocaleString("ru-RU")}</span> контактов при таких параметрах.</p>}</div>}</div>
          </details>
          <FilterAccordion title="Сегмент" count={segment && segment !== "Сегмент не определён" ? 1 : 0} open={openFilters.segment} onToggle={() => setOpenFilters((current) => ({ ...current, segment: !current.segment }))} summary={segment !== "Сегмент не определён" ? segment : ""}>
            <Field label="Название сегмента"><input className="input" value={segment} onChange={(event) => setSegment(event.target.value)} placeholder="Например: Юридические услуги" /><span className="mt-1.5 block text-[11px] leading-4 text-ink-500">Определяем по описанию нужных компаний. Можно уточнить название вручную.</span></Field>
          </FilterAccordion>
        </div>
        <button onClick={() => void prepareCollection()} disabled={loading || !okveds.length || !canManage || quota.remaining === 0 || !requestedContactsValue || deepCriteriaMissing} className="btn-primary mt-4 w-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{loading ? "Готовим портрет…" : "Проверить и запустить"}</button>
      </aside>}

      <section className="min-w-0">
        {notice && <div className="mb-4 rounded-lg border border-mint-200 bg-mint-50 px-4 py-3 text-sm text-mint-800">{notice}</div>}
        {draftRun && <div className="mb-4 rounded-xl border border-slate-300 bg-white p-5"><div className="text-xs text-ink-500">Проверьте перед запуском</div><h2 className="mt-1 text-lg font-semibold text-slate-900">Кого мы ищем</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-ink-700">{draftRun.searchSummary}</p>{draftRun.safeDeepStage && <div className="mt-4 rounded-lg border border-mint-200 bg-mint-50 px-3 py-2.5 text-xs leading-5 text-mint-800">Сначала выполним безопасную часть глубокого поиска и сохраним промежуточный результат. Перед продолжением покажем обновлённый прогноз.</div>}{draftRun.budgetEstimate && <div className="mt-4 grid gap-2 rounded-lg bg-[#fafbf9] p-3 text-xs text-ink-600 sm:grid-cols-3"><div>Режим<br /><strong className="font-medium text-slate-900">{draftRun.searchMode === "deep" ? "Глубокий" : "Обычный"}</strong></div><div>Проверим до<br /><strong className="metric-number font-medium text-slate-900">{draftRun.budgetEstimate.maxCompanies.toLocaleString("ru-RU")} компаний</strong></div><div>Прогноз<br /><strong className="metric-number font-medium text-slate-900">около {draftRun.budgetEstimate.expectedContacts.toLocaleString("ru-RU")} контактов</strong></div></div>}<div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><div><div className="text-sm text-ink-500">Цель: <span className="metric-number font-semibold text-slate-900">до {draftRun.targetContacts.toLocaleString("ru-RU")}</span> новых контактов</div><div className="mt-1 text-xs text-ink-500">Расчётное время: <span className="metric-number font-medium text-ink-700">{formatProspectingEstimate(estimateProspectingTime(draftRun))}</span></div></div><div className="flex gap-2"><button onClick={() => setDraftRun(null)} className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium">Изменить</button><button onClick={confirmCollection} disabled={loading} className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">Всё верно, начать</button></div></div></div>}
        {activeRun && <RunStatus run={activeRun} pollIssue={pollIssue} />}
        {activeRun?.contacts?.length ? <div className="mt-4 overflow-hidden rounded-xl border border-line bg-white"><div className="flex items-center justify-between border-b border-line px-4 py-3"><div><h2 className="text-sm font-semibold text-slate-900">Найденные контакты</h2><p className="mt-0.5 text-xs text-ink-500">Они уже сохранены в общей базе и готовы для кампаний.</p></div><span className="metric-number text-xs text-ink-500">{activeRun.contacts.length}</span></div><div className="scroll-x max-h-[65vh] overflow-y-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="sticky top-0 z-10 bg-[#fafbf9] text-xs text-ink-500"><tr><th className="px-4 py-3 font-medium">Контакт</th><th className="px-4 py-3 font-medium">Компания</th><th className="px-4 py-3 font-medium">Роль</th><th className="px-4 py-3 font-medium">Проверка</th></tr></thead><tbody>{activeRun.contacts.map(({ company, contact }) => <tr key={`${company.inn}:${contact.email}`} className="border-t border-line"><td className="px-4 py-3"><div className="font-medium text-slate-900">{contact.email}</div>{contact.name && <div className="mt-0.5 text-xs text-ink-500">{contact.name}</div>}</td><td className="px-4 py-3 text-ink-700">{effectiveCommunicationName(company) ?? <Placeholder>Название не найдено</Placeholder>}</td><td className="px-4 py-3 text-ink-700">{contact.role ?? contactKindLabel(contact.kind)}</td><td className="px-4 py-3"><Badge tone="green">Проверен</Badge></td></tr>)}</tbody></table></div></div> : <EmptyState loading={loading || Boolean(activeRun && ["QUEUED", "RUNNING"].includes(activeRun.status))} profilePublished={profilePublished} />}
      </section>
    </div>
    {comparisonOpen && <ComparisonDrawer okveds={okveds} onClose={() => setComparisonOpen(false)} />}
    {okvedPickerOpen && <OkvedPicker selected={okveds} onChange={setOkveds} onClose={() => setOkvedPickerOpen(false)} />}
    {rolePickerOpen && <RolePicker selected={filters.desiredRoles} onChange={(desiredRoles) => setFilters({ ...filters, desiredRoles })} onClose={() => setRolePickerOpen(false)} />}
    {deepLimitPrompt && <DeepSearchConsentDialog
      assessment={deepLimitPrompt.assessment}
      loading={loading}
      onClose={() => setDeepLimitPrompt(null)}
      onStandard={() => { setDeepLimitPrompt(null); setSearchMode("standard"); setNotice("Переключили на обычный поиск. Проверьте прогноз и запустите подбор."); }}
      onContinue={() => void prepareCollection(true, deepLimitPrompt.summary)}
    />}
  </div>;
}

function RunStatus({ run, pollIssue }: { run: CollectionRun; pollIssue?: string }) {
  const running = ["QUEUED", "RUNNING"].includes(run.status);
  const overshoot = run.completionReason === "OVERSHOOT" || (!running && (run.acceptedCount ?? 0) > run.targetContacts);
  const failed = run.status === "FAILED";
  const estimate = estimateProspectingTime(run);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, run.id]);

  const anchor = dateTime(run.startedAt ?? run.createdAt);
  const elapsedSeconds = anchor ? Math.max(0, Math.floor((now - anchor) / 1000)) : 0;
  const delayed = running && elapsedSeconds > estimate.maxSeconds;
  const contactProgress = (run.acceptedCount ?? 0) / Math.max(1, run.targetContacts);
  const candidateProgress = (run.processedCount ?? 0) / Math.max(1, estimate.expectedCandidates);
  const progress = running ? Math.min(96, Math.max(4, Math.max(contactProgress, candidateProgress) * 100)) : 100;
  const failureCode = extractSupportCode(run.error) ?? run.latestIssueCode ?? "SRC-2001";
  const observedConversion = (run.processedCount ?? 0) >= 30
    ? (run.acceptedCount ?? 0) / Math.max(1, run.processedCount ?? 0)
    : null;
  const projectedContacts = observedConversion == null
    ? null
    : Math.min(run.targetContacts, Math.floor(run.maxCandidates * observedConversion));

  return <div className={`rounded-xl border bg-white p-4 ${failed ? "border-red-200" : "border-line"}`} aria-live="polite">
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs text-ink-500">
          {running && <span className="relative flex h-2 w-2" aria-hidden="true"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-500 opacity-40" /><span className="relative inline-flex h-2 w-2 rounded-full bg-mint-700" /></span>}
          <span>{running ? "Подбираем контакты" : runStatus(run.status)}</span>
        </div>
        <div className="mt-1 text-sm font-medium text-slate-900">{failed ? "Подбор остановился раньше времени" : running ? delayed ? "Мы немного не успеваем — скоро закончим" : "Каждый готовый контакт сразу сохраняется в базе" : overshoot ? "Получилось даже чуть больше, чем хотели — это за наш счёт!" : run.completionReason === "SOURCE_EXHAUSTED" ? "Подходящие компании в этой выборке закончились" : "База готова"}</div>
        {failed && <p className="mt-1 max-w-2xl text-xs leading-5 text-red-700">Уже найденные контакты сохранены. Попробуйте запустить подбор ещё раз. Если ситуация повторится, сообщите поддержке код <span className="metric-number font-medium">{failureCode}</span>.</p>}
      </div>
      <Metric value={run.processedCount ?? 0} label="компаний проверено" />
      <Metric value={run.acceptedCount ?? 0} label="контактов найдено" tone />
    </div>

    {running && <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
        <span>Расчётное время: <span className="metric-number font-medium text-ink-700">{formatProspectingEstimate(estimate)}</span></span>
        <span>Прошло: <span className="metric-number font-medium text-ink-700">{formatElapsedTime(elapsedSeconds)}</span></span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface" role="progressbar" aria-label="Ход подбора контактов" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <div className="h-full rounded-full bg-mint-600 transition-[width] duration-700" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-[11px] leading-4 text-ink-500">{delayed ? "Продолжаем проверять компании и сохранять найденное — страницу можно закрыть." : run.status === "QUEUED" ? "Готовим поиск. Можно закрыть страницу — подбор продолжится автоматически." : "Проверяем компании, контакты и доступные подтверждения."}</p>
      {observedConversion != null && <p className="mt-1 text-[11px] leading-4 text-ink-500">По первым <span className="metric-number">{(run.processedCount ?? 0).toLocaleString("ru-RU")}</span> компаниям находим контакты в <span className="metric-number">{Math.round(observedConversion * 100)}%</span> случаев. При таком темпе ожидаем около <span className="metric-number">{projectedContacts?.toLocaleString("ru-RU")}</span>.</p>}
    </div>}

    {pollIssue && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{pollIssue}</div>}
    {!failed && (run.issueCount ?? 0) > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{running ? "Часть данных временно недоступна. Продолжаем подбор по доступным источникам." : "Часть данных была временно недоступна. Мы сохранили все контакты, которые удалось подтвердить."}{run.latestIssueCode && <> Код: <span className="metric-number font-medium">{run.latestIssueCode}</span>.</>}</div>}
  </div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-ink-700">{label}</span>{children}</label>; }
function FilterAccordion({ title, count, summary, open, onToggle, children }: { title: string; count: number; summary?: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <section className={`overflow-hidden rounded-xl border bg-white ${open ? "border-mint-200" : "border-line"}`}>
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mint-200">
      <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-ink-700">{title}</span>{!open && summary && <span className="mt-0.5 block truncate text-[10px] text-ink-400">{summary}</span>}</span>
      {count > 0 && <span className="metric-number inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-mint-100 px-1.5 text-[10px] font-semibold text-mint-700">{count}</span>}
      <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3.5 w-3.5 shrink-0 fill-none stroke-current text-ink-400 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && <div className="border-t border-line bg-[#fafbf9] p-3">{children}</div>}
  </section>;
}
function Toggle({ label, checked, disabled = false, note, onChange }: { label: string; checked: boolean; disabled?: boolean; note?: string; onChange: (value: boolean) => void }) { return <label className={`flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink-700 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}><span><span className="block">{label}</span>{note && <span className="mt-0.5 block text-[11px] leading-4 text-ink-400">{note}</span>}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-emerald-700 disabled:opacity-60" /></label>; }
function Metric({ value, label, tone }: { value: number; label: string; tone?: boolean }) { return <div className={`rounded-xl border p-4 ${tone ? "border-mint-200 bg-mint-50" : "border-line bg-white"}`}><div className="metric-number text-2xl font-semibold text-slate-900">{value}</div><div className="mt-1 text-xs text-ink-500">{label}</div></div>; }
function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "amber" }) { return <span className={`rounded px-2 py-1 text-[11px] font-medium ${tone === "green" ? "bg-mint-100 text-mint-700" : "bg-amber-50 text-amber-800"}`}>{children}</span>; }
function Placeholder({ children }: { children: React.ReactNode }) { return <span className="inline-flex rounded-md border border-dashed border-line bg-[#fafbf9] px-2 py-0.5 text-[11px] font-normal italic text-ink-400">{children}</span>; }
function EmptyState({ loading, profilePublished }: { loading: boolean; profilePublished: boolean }) { return <div className="flex min-h-[460px] items-center justify-center rounded-xl border border-dashed border-line bg-[#fcfdfc]"><div className="max-w-sm px-6 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-white text-xl text-mint-700">✦</div><h2 className="mt-4 text-lg font-semibold text-slate-900">{loading ? "Собираем базу" : "Опишите идеального клиента"}</h2><p className="mt-2 text-sm leading-6 text-ink-500">{loading ? "Готовые контакты будут появляться здесь и в общей базе." : profilePublished ? "Возьмите описание из профиля, уточните его и только затем примените предложенные фильтры." : "Можно начать с описания компаний, а профиль опубликовать позже для более точных подсказок."}</p></div></div>; }
function runStatus(status: string) { return ({ DRAFT: "Ожидает подтверждения", QUEUED: "В очереди", RUNNING: "Выполняется", COMPLETED: "Сбор завершён", FAILED: "Сбор остановлен", CANCELLED: "Сбор отменён" } as Record<string, string>)[status] ?? status; }
function contactKindLabel(kind: string) { return ({ person: "Персональный", personal: "Персональный", generic: "Общий", unknown: "Не определена" } as Record<string, string>)[kind] ?? kind; }
function split(value: string) { const items = value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean); return items.length ? items : undefined; }
function optionalNumber(value: string) { const number = Number(value); return value.trim() && Number.isFinite(number) ? number : undefined; }
function optionalPositiveInteger(value: string) { const number = Number(value); return value.trim() && Number.isInteger(number) && number > 0 ? number : undefined; }
function numberText(value?: number) { return value == null ? "" : String(value); }
function apiError(body: unknown, fallback: string) { if (!body || typeof body !== "object") return fallback; const value = body as { error?: unknown; code?: unknown }; const message = typeof value.error === "string" ? value.error : fallback; return typeof value.code === "string" ? `${message} Код: ${value.code}` : message; }
function dateTime(value?: string | Date | null) { if (!value) return 0; const parsed = new Date(value).getTime(); return Number.isFinite(parsed) ? parsed : 0; }
function extractSupportCode(value?: string | null) { return value?.match(/\b(?:CNT|SRC|AI|SYS)-\d{4}\b/)?.[0]; }

function OkvedPicker({ selected, onChange, onClose }: { selected: Okved[]; onChange: (items: Okved[]) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [roots, setRoots] = useState<OkvedTreeNode[]>([]);
  const [searchItems, setSearchItems] = useState<OkvedTreeNode[]>([]);
  const [children, setChildren] = useState<Record<string, OkvedTreeNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingBranches, setLoadingBranches] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/company-data/okveds", { signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (response.ok) setRoots(body.items ?? []);
    }).catch(() => setRoots([])).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) { setSearchItems([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/company-data/okveds?q=${encodeURIComponent(normalized)}`, { signal: controller.signal });
        const body = await response.json();
        if (response.ok) setSearchItems(body.items ?? []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setSearchItems([]);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const selectedCodes = new Set(selected.map((item) => item.code));
  function toggle(node: OkvedTreeNode) {
    if (node.kind !== "code" || !node.code) return;
    const item = { code: node.code, description: node.description };
    onChange(selectedCodes.has(node.code) ? selected.filter((value) => value.code !== node.code) : [...selected, item]);
  }
  async function toggleExpanded(node: OkvedTreeNode) {
    if (!node.hasChildren) return;
    if (expanded.has(node.id)) {
      setExpanded((current) => { const next = new Set(current); next.delete(node.id); return next; });
      return;
    }
    setExpanded((current) => new Set(current).add(node.id));
    if (children[node.id]) return;
    setLoadingBranches((current) => new Set(current).add(node.id));
    try {
      const parent = node.kind === "section" ? `section:${node.section}` : node.code ?? "";
      const response = await fetch(`/api/company-data/okveds?parent=${encodeURIComponent(parent)}`);
      const body = await response.json();
      setChildren((current) => ({ ...current, [node.id]: response.ok ? body.items ?? [] : [] }));
    } catch {
      setChildren((current) => ({ ...current, [node.id]: [] }));
    } finally {
      setLoadingBranches((current) => { const next = new Set(current); next.delete(node.id); return next; });
    }
  }

  const searching = Boolean(query.trim());
  return <Modal title="Выбрать ОКВЭДы" description="Полный классификатор ОКВЭД 2: раскройте раздел, класс, подкласс, группу, подгруппу и вид — или найдите код по смыслу." onClose={onClose}>
    <label className="block"><span className="sr-only">Найти ОКВЭД</span><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Код или вид деятельности…" /></label>
    <div className="mt-3 max-h-[52vh] overflow-y-auto rounded-lg border border-line bg-white" aria-live="polite">
      {loading && (searching || !roots.length) ? <div className="p-5 text-sm text-ink-500">Ищем в справочнике…</div> : searching ? searchItems.length ? searchItems.map((node) => <OkvedSearchRow key={node.id} node={node} checked={Boolean(node.code && selectedCodes.has(node.code))} onToggle={() => toggle(node)} />) : <div className="p-5 text-sm text-ink-500">Ничего не найдено. Попробуйте более короткий запрос.</div> : roots.map((node) => <OkvedTreeRow key={node.id} node={node} depth={0} selectedCodes={selectedCodes} expanded={expanded} children={children} loadingBranches={loadingBranches} onToggle={toggle} onExpand={toggleExpanded} />)}
    </div>
    {selected.length > 0 && <div className="mt-3 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">{selected.map((item) => <button type="button" key={item.code} title={`Убрать: ${item.description}`} onClick={() => onChange(selected.filter((value) => value.code !== item.code))} className="metric-number rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink-700">{item.code} <span className="text-ink-400">×</span></button>)}</div>}
    <div className="mt-4 flex items-center justify-between"><span className="metric-number text-xs text-ink-500">Выбрано: {selected.length}</span><button type="button" onClick={onClose} className="btn-primary px-4 py-2 text-sm font-semibold">Готово</button></div>
  </Modal>;
}

function OkvedTreeRow({ node, depth, selectedCodes, expanded, children, loadingBranches, onToggle, onExpand }: {
  node: OkvedTreeNode; depth: number; selectedCodes: Set<string>; expanded: Set<string>;
  children: Record<string, OkvedTreeNode[]>; loadingBranches: Set<string>;
  onToggle: (node: OkvedTreeNode) => void; onExpand: (node: OkvedTreeNode) => void;
}) {
  const isExpanded = expanded.has(node.id);
  const checked = Boolean(node.code && selectedCodes.has(node.code));
  return <div className={depth > 0 ? "ml-4 border-l border-line" : ""}>
    <div className={`flex min-h-11 items-start gap-2 border-b border-line px-2.5 py-2 last:border-b-0 ${checked ? "bg-mint-50" : "hover:bg-surface"}`}>
      {node.hasChildren ? <button type="button" aria-label={`${isExpanded ? "Свернуть" : "Раскрыть"} ${node.kind === "section" ? `раздел ${node.section}` : `ОКВЭД ${node.code}`}`} aria-expanded={isExpanded} onClick={() => onExpand(node)} className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs text-ink-500 hover:bg-white">{loadingBranches.has(node.id) ? "…" : isExpanded ? "⌄" : "›"}</button> : <span className="h-6 w-6 shrink-0" />}
      <button type="button" onClick={() => node.kind === "section" ? onExpand(node) : onToggle(node)} className="min-w-0 flex-1 text-left">
        <span className="flex items-baseline gap-2"><span className={`${node.kind === "code" ? "metric-number" : ""} shrink-0 text-xs font-semibold text-slate-900`}>{node.kind === "section" ? `Раздел ${node.section}` : node.code}</span><span className="text-xs leading-5 text-ink-700">{node.description}</span></span>
      </button>
      {node.kind === "code" && <button type="button" aria-label={checked ? `Убрать ОКВЭД ${node.code}` : `Выбрать ОКВЭД ${node.code}`} aria-pressed={checked} onClick={() => onToggle(node)} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] ${checked ? "border-mint-600 bg-mint-700 text-white" : "border-line bg-white"}`}>{checked ? "✓" : ""}</button>}
    </div>
    {isExpanded && (children[node.id] ?? []).map((child) => <OkvedTreeRow key={child.id} node={child} depth={depth + 1} selectedCodes={selectedCodes} expanded={expanded} children={children} loadingBranches={loadingBranches} onToggle={onToggle} onExpand={onExpand} />)}
  </div>;
}

function OkvedSearchRow({ node, checked, onToggle }: { node: OkvedTreeNode; checked: boolean; onToggle: () => void }) {
  return <button type="button" onClick={onToggle} className={`flex w-full items-start gap-3 border-b border-line px-3 py-3 text-left last:border-0 ${checked ? "bg-mint-50" : "hover:bg-surface"}`}><span className="metric-number mt-0.5 min-w-16 text-xs font-semibold text-slate-900">{node.code}</span><span className="min-w-0 flex-1"><span className="block text-xs leading-5 text-ink-700">{node.description}</span><span className="block text-[11px] leading-4 text-ink-400">Раздел {node.section} · {node.sectionDescription}</span></span><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] ${checked ? "border-mint-600 bg-mint-700 text-white" : "border-line bg-white"}`}>{checked ? "✓" : ""}</span></button>;
}

function RolePicker({ selected, onChange, onClose }: { selected: string[]; onChange: (items: string[]) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const options = PROSPECTING_ROLE_OPTIONS.filter((option) => !normalizedQuery || [option.value, ...option.aliases].some((value) => value.toLocaleLowerCase("ru-RU").includes(normalizedQuery)));
  const groups = [...new Set(options.map((option) => option.group))];
  function toggle(role: string) { onChange(selected.includes(role) ? selected.filter((item) => item !== role) : [...selected, role]); }
  return <Modal title="Выбрать желаемых ЛПР" description="Мы приоритизируем эти роли в поиске, но сохраним и другие полезные контакты компании." onClose={onClose}>
    <label className="block"><span className="sr-only">Найти роль</span><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например, маркетинг или HRD…" /></label>
    <div className="mt-3 max-h-[52vh] overflow-y-auto rounded-lg border border-line bg-white p-3">{groups.map((group) => <section key={group} className="mb-4 last:mb-0"><h3 className="mb-2 text-xs font-medium text-ink-500">{group}</h3><div className="grid gap-1.5 sm:grid-cols-2">{options.filter((option) => option.group === group).map((option) => { const checked = selected.includes(option.value); return <button type="button" key={option.value} aria-pressed={checked} onClick={() => toggle(option.value)} className={`rounded-lg border px-3 py-2.5 text-left text-xs ${checked ? "border-mint-300 bg-mint-50 font-medium text-mint-800" : "border-line text-ink-700 hover:bg-surface"}`}>{option.value}</button>; })}</div></section>)}</div>
    <div className="mt-4 flex items-center justify-between"><span className="metric-number text-xs text-ink-500">Выбрано: {selected.length}</span><button type="button" onClick={onClose} className="btn-primary px-4 py-2 text-sm font-semibold">Готово</button></div>
  </Modal>;
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label={title}><button type="button" className="absolute inset-0" aria-label="Закрыть" onClick={onClose} /><div className="relative w-full max-w-2xl rounded-xl border border-line bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-slate-900">{title}</h2><p className="mt-1 text-sm leading-5 text-ink-500">{description}</p></div><button type="button" onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-600 hover:bg-surface">Закрыть</button></div><div className="mt-5">{children}</div></div></div>;
}

function ComparisonDrawer({ okveds, onClose }: { okveds: Okved[]; onClose: () => void }) {
  const [data, setData] = useState<{ results?: Array<{ provider: string; summary: Record<string, number> }>; error?: string } | null>(null);
  async function run() { const okved = okveds[0]?.code || "62.01"; setData(null); const response = await fetch("/api/admin/company-data/experiment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checko: { by: "okved", query: okved, obj: "org", active: true, limit: 30 }, datanewton: { limit: 30, filters: { okved: [okved] } }, hunterLimitPerDomain: 10 }) }); setData(await response.json()); }
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/25" role="dialog" aria-modal="true"><button className="absolute inset-0" aria-label="Закрыть" onClick={onClose} /><div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-line bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><div className="text-xs font-medium text-amber-700">Служебное окно</div><h2 className="mt-1 text-xl font-semibold text-slate-900">Сравнение источников</h2></div><button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm">Закрыть</button></div><button onClick={run} className="btn-primary mt-5 px-4 py-2 text-sm font-semibold">Запустить сравнение</button><div className="mt-5 space-y-3">{data?.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{data.error}</div>}{data?.results?.map((result) => <div key={result.provider} className="rounded-xl border border-line p-4"><strong>{result.provider}</strong><div className="mt-3 metric-number text-sm text-ink-600">{result.summary.companies ?? 0} компаний · {result.summary.uniqueHunterEmails ?? 0} адресов</div></div>)}</div></div></div>;
}
