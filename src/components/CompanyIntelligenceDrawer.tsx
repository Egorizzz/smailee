"use client";

import { useEffect, useState } from "react";

type CompanyRow = {
  companyId: string;
  inn?: string;
  name?: string;
  domain?: string;
  companyEmails: string[];
  hunterEmails: string[];
  phones: string[];
  availableFields: number;
};

type HunterContact = {
  email: string;
  position?: string;
  confidence?: number;
};

type SiteFact = {
  category: string;
  value: string;
  evidence: string;
  confidence: number;
  sourceUrl: string;
};

type SiteResult = {
  status: string;
  creditsUsed: number;
  analyzedAt?: string | null;
  intelligence?: {
    summary?: string;
    personalizationHooks?: SiteFact[];
  };
};

export function CompanyIntelligenceDrawer({
  row, details, enriching, onEnrich, onClose,
}: {
  row: CompanyRow;
  details: HunterContact[];
  enriching: boolean;
  onEnrich: () => void;
  onClose: () => void;
}) {
  const [site, setSite] = useState<SiteResult | null>(null);
  const [siteLoading, setSiteLoading] = useState(false);
  const [siteError, setSiteError] = useState("");

  useEffect(() => {
    if (!row.domain) return;
    const controller = new AbortController();
    fetch(`/api/company-data/site-intelligence?companyId=${encodeURIComponent(row.companyId)}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<SiteResult> : null)
      .then((value) => { if (value) setSite(value); })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error); });
    return () => controller.abort();
  }, [row.companyId, row.domain]);

  async function analyzeSite() {
    setSiteLoading(true);
    setSiteError("");
    try {
      const response = await fetch("/api/company-data/site-intelligence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: row.companyId, maxPages: 3 }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Не удалось изучить сайт");
      setSite(body);
    } catch (error) {
      setSiteError(error instanceof Error ? error.message : "Не удалось изучить сайт");
    } finally {
      setSiteLoading(false);
    }
  }

  const hooks = site?.intelligence?.personalizationHooks ?? [];
  const emails = [...new Set([...row.companyEmails, ...row.hunterEmails])];

  return <div className="fixed inset-0 z-40 flex justify-end bg-black/20" role="dialog" aria-modal="true" aria-label="Карточка компании">
    <button className="absolute inset-0 cursor-default" aria-label="Закрыть" onClick={onClose} />
    <aside className="relative h-full w-full max-w-md overflow-y-auto border-l border-line bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div><div className="text-xs text-ink-500">Карточка компании</div><h2 className="mt-1 text-xl font-semibold text-slate-900">{row.name ?? "Без названия"}</h2></div>
        <button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm">Закрыть</button>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <Info label="ИНН" value={row.inn ?? "—"} numeric />
        <Info label="Домен" value={row.domain ?? "—"} />
        <Info label="Телефоны" value={row.phones.join(", ") || "—"} />
        <Info label="Доступно данных" value={`${row.availableFields} полей`} numeric />
      </dl>

      <section className="mt-7 border-t border-line pt-6">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-sm font-semibold text-slate-900">Сигналы с сайта</h3><p className="mt-1 text-xs leading-5 text-ink-500">До трёх страниц, только факты со ссылкой на источник.</p></div>
          {row.domain && <button onClick={analyzeSite} disabled={siteLoading} className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface disabled:opacity-50">{siteLoading ? "Изучаем…" : site ? "Показать актуальные" : "Изучить сайт"}</button>}
        </div>
        {siteError && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">{siteError}</div>}
        {site && <div className="mt-3 space-y-3">
          {site.intelligence?.summary && <p className="rounded-lg bg-surface p-3 text-sm leading-5 text-ink-700">{site.intelligence.summary}</p>}
          {hooks.map((hook) => <div key={`${hook.sourceUrl}:${hook.value}`} className="rounded-lg border border-line p-3">
            <p className="text-sm font-medium leading-5 text-slate-900">{hook.value}</p>
            {hook.evidence && <p className="mt-1 text-xs leading-5 text-ink-500">«{hook.evidence}»</p>}
            <a href={hook.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-medium text-mint-700 hover:underline">Открыть источник</a>
          </div>)}
          {!hooks.length && <div className="rounded-lg bg-surface p-3 text-xs leading-5 text-ink-500">Надёжных поводов для персонализации на выбранных страницах не найдено.</div>}
          <div className="metric-number text-[11px] text-ink-500">{site.creditsUsed} стр. · {site.analyzedAt ? new Date(site.analyzedAt).toLocaleDateString("ru-RU") : "обработка"}</div>
        </div>}
        {!row.domain && <div className="mt-3 rounded-lg bg-surface p-3 text-xs text-ink-500">Для анализа нужен домен компании.</div>}
      </section>

      <section className="mt-7 border-t border-line pt-6">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900">Рабочие контакты</h3>{row.domain && <button onClick={onEnrich} disabled={enriching} className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface disabled:opacity-50">{enriching ? "Ищем…" : row.hunterEmails.length ? "Показать сохранённые" : "Найти на домене"}</button>}</div>
        <div className="mt-3 space-y-2">{emails.map((email) => { const detail = details.find((item) => item.email === email); return <div key={email} className="rounded-lg border border-line p-3"><div className="text-sm font-medium text-slate-900">{email}</div><div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-500"><span>{row.hunterEmails.includes(email) ? "Hunter" : "Реестр"}</span>{detail?.position && <span>· {detail.position}</span>}{detail?.confidence !== undefined && <span className="metric-number">· уверенность {detail.confidence}%</span>}</div></div>;})}{!emails.length && <div className="rounded-lg bg-surface p-4 text-sm text-ink-500">Контактов пока нет. Поиск Hunter расходует кредиты только после вашего нажатия.</div>}</div>
      </section>
    </aside>
  </div>;
}

function Info({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return <div className="rounded-lg border border-line p-3"><dt className="text-xs text-ink-500">{label}</dt><dd className={`mt-1 break-words text-sm font-medium text-slate-900 ${numeric ? "metric-number" : ""}`}>{value}</dd></div>;
}
