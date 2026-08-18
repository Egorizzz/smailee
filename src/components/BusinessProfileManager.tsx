"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { BusinessProfileData } from "@/lib/businessProfile/types";
import {
  answerProfileQuestion,
  cancelWebsiteCrawl,
  publishProfile,
  restoreProfileVersion,
  retryProfileSynthesis,
  saveAnalyzedProfileDraft,
  startWebsiteCrawl,
  type ProfileActionResult,
} from "@/app/(app)/app/settings/profile/actions";

type CrawlView = {
  id: string;
  rootUrl: string;
  status: string;
  discoveredCount: number;
  crawledCount: number;
  analyzedCount: number;
  failedCount: number;
  pageLimit: number;
  error: string | null;
  createdAt: string;
  synthesizedAt: string | null;
  profileVersion: number | null;
  canRetrySynthesis: boolean;
};

type CrawlHistoryView = CrawlView & { profile: BusinessProfileData | null };

type QuestionView = {
  id: string;
  category: string;
  question: string;
  reason: string | null;
  critical: boolean;
  status: string;
  answer: string | null;
};

const ACTIVE = new Set(["PENDING", "CRAWLING", "ANALYZING"]);

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Готовим обход",
  CRAWLING: "Читаем сайт",
  ANALYZING: "ИИ собирает факты",
  READY_FOR_REVIEW: "Черновик готов к проверке",
  FAILED: "Анализ остановлен",
  CANCELED: "Остановлен",
};

function Message({ result }: { result: ProfileActionResult | null }) {
  if (!result) return null;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${result.error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      {result.error || result.ok}
    </div>
  );
}

export function BusinessProfileManager({
  profile,
  publishedProfile,
  hasStoredDraft,
  crawl,
  crawlHistory,
  questions,
  publishedAt,
  stale,
  firecrawlConfigured,
  setupMode,
}: {
  profile: BusinessProfileData;
  publishedProfile: BusinessProfileData | null;
  hasStoredDraft: boolean;
  crawl: CrawlView | null;
  crawlHistory: CrawlHistoryView[];
  questions: QuestionView[];
  publishedAt: string | null;
  stale: boolean;
  firecrawlConfigured: boolean;
  setupMode: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ProfileActionResult | null>(null);
  const [confirmPricing, setConfirmPricing] = useState(false);
  const [draftEditorOpen, setDraftEditorOpen] = useState(false);
  const active = Boolean(crawl && ACTIVE.has(crawl.status));

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [active, router]);

  function submit(
    event: FormEvent<HTMLFormElement>,
    action: (data: FormData) => Promise<ProfileActionResult>,
    onSuccess?: () => void,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const nextResult = await action(form);
      setResult(nextResult);
      if (nextResult.ok) onSuccess?.();
      router.refresh();
    });
  }

  const progressBase = crawl?.status === "ANALYZING" ? crawl.crawledCount : crawl?.discoveredCount || crawl?.pageLimit || 1;
  const progressValue = crawl?.status === "ANALYZING" ? crawl.analyzedCount : crawl?.crawledCount || 0;
  const progress = Math.min(100, Math.round((progressValue / Math.max(1, progressBase)) * 100));
  const hasDraftContent = hasStoredDraft && Boolean(
    profile.companyName
    || profile.websiteUrl
    || profile.summary
    || profile.offers.length
    || profile.products.length
    || profile.targetAudiences.length
    || profile.painPoints.length
    || profile.differentiators.length
    || profile.proof.length
    || profile.geography.length
    || profile.salesProcess.length
    || profile.restrictions.length
    || profile.tone
    || profile.manualNotes,
  );

  return (
    <div className="mt-6 space-y-6">
      <Message result={result} />

      {!publishedAt && (
        <section className="rounded-xl border border-mint-300 bg-mint-100/30 p-5">
          <h2 className="text-lg font-semibold text-slate-900">Как заполнить профиль</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            ИИ может изучить сайт и подготовить черновик. Если сайта нет, заполните черновик ниже вручную.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href="#website-analysis" className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
              Создать профиль компании
            </a>
          </div>
        </section>
      )}

      <details className="group rounded-xl border border-line bg-white">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-5 marker:content-none">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Опубликованный профиль</h2>
              {stale && publishedAt && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Нужно обновить</span>}
              {!publishedAt && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Не опубликован</span>}
            </div>
            <p className="mt-1 text-sm text-ink-500">
              Нажмите, чтобы посмотреть данные, которые сейчас используются в письмах и ответах.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {publishedAt && <span className="metric-number hidden text-xs text-ink-500 sm:inline">Обновлён {new Date(publishedAt).toLocaleDateString("ru-RU")}</span>}
            <span aria-hidden="true" className="text-lg text-ink-500 transition group-open:rotate-180">⌄</span>
          </div>
        </summary>
        <div className="border-t border-line px-5 py-5">
          {publishedProfile ? <PublishedProfileDetails profile={publishedProfile} /> : (
            <p className="text-sm text-ink-500">Опубликованной версии пока нет. Сначала создайте и опубликуйте черновик.</p>
          )}
        </div>
      </details>

      <section id="website-analysis" className="scroll-mt-6 rounded-xl border border-line bg-white p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Создать профиль компании</h2>
            <p className="mt-1 text-sm text-ink-500">Соберём оффер, продукты, цены, аудитории, кейсы и ограничения со страниц сайта.</p>
          </div>
        </div>

        {!firecrawlConfigured && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Анализ сайта временно недоступен. Мы уже знаем о проблеме и восстанавливаем работу.
          </div>
        )}

        {crawl && (
          <div className={`mt-4 rounded-lg border p-4 ${crawl.status === "FAILED" ? "border-red-200 bg-red-50" : crawl.status === "READY_FOR_REVIEW" && !crawl.canRetrySynthesis && hasDraftContent ? "border-emerald-200 bg-emerald-50" : "border-line bg-surface"}`}>
            {crawl.status === "READY_FOR_REVIEW" && !crawl.canRetrySynthesis && hasDraftContent ? (
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">✓</span>
                  <div>
                    <div className="text-sm font-semibold text-emerald-950">Профиль успешно собран</div>
                    <p className="mt-0.5 text-sm text-emerald-800">Черновик готов. Проверьте данные и опубликуйте профиль.</p>
                    <div className="mt-1 max-w-xl truncate text-xs text-emerald-700">{crawl.rootUrl}</div>
                  </div>
                </div>
                <a href="#profile-draft" className="shrink-0 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100">
                  Проверить черновик
                </a>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{STATUS_LABELS[crawl.status] || crawl.status}</div>
                  <div className="mt-0.5 max-w-xl truncate text-xs text-ink-500">{crawl.rootUrl}</div>
                </div>
                <div className="flex items-center gap-3">
                  {!active && crawl.canRetrySynthesis && (
                    <button type="button" disabled={pending} onClick={() => startTransition(async () => { setResult(await retryProfileSynthesis(crawl.id)); router.refresh(); })} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                      Повторить сборку ИИ
                    </button>
                  )}
                  {active && (
                    <button type="button" disabled={pending} onClick={() => startTransition(async () => { setResult(await cancelWebsiteCrawl(crawl.id)); router.refresh(); })} className="text-xs font-semibold text-red-600 disabled:opacity-50">
                      Остановить
                    </button>
                  )}
                </div>
              </div>
            )}
            {active && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-mint-500 transition-all" style={{ width: `${Math.max(4, progress)}%` }} /></div>
              </div>
            )}
            {(active || crawl.crawledCount > 0) && (
              <div className="metric-number mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                <span>Карта сайта: {crawl.discoveredCount}</span><span>Прочитано: {crawl.crawledCount}</span><span>Изучено ИИ: {crawl.analyzedCount}</span>
              </div>
            )}
            {crawl.error && <p className="mt-3 text-sm text-red-700">{crawl.error}</p>}
          </div>
        )}

        {!active && (
          <form className="mt-5 space-y-4" onSubmit={(event) => submit(event, startWebsiteCrawl)}>
            <Field label="Адрес сайта"><input className="input" name="websiteUrl" required defaultValue={profile.websiteUrl ?? ""} placeholder="https://example.ru" /></Field>
            <details className="rounded-lg border border-line bg-surface p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">Детальные настройки</summary>
              <div className="mt-4 space-y-4">
                <Field label="Включить только пути" hint="По одному regex-пути в строке; оставьте пустым для всего сайта"><textarea className="input" name="includePaths" rows={3} placeholder="products/.*" /></Field>
                <Field label="Исключить пути" hint="Авторизация, корзина, поиск и пагинация исключаются автоматически"><textarea className="input" name="excludePaths" rows={3} placeholder="blog/archive/.*" /></Field>
                <label className="flex items-start gap-3 text-sm text-slate-800"><input className="mt-1" type="checkbox" name="allowSubdomains" /><span>Включить поддомены компании</span></label>
              </div>
            </details>
            <button disabled={pending || !firecrawlConfigured} className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
              {pending ? "Запускаем…" : "Проанализировать сайт"}
            </button>
          </form>
        )}
        {crawlHistory.length > 0 && (
          <CrawlHistory
            items={crawlHistory}
            pending={pending}
            run={startTransition}
            onResult={setResult}
            refresh={() => router.refresh()}
          />
        )}
        <section id="profile-draft" className="mt-6 scroll-mt-6 rounded-lg border border-line bg-white p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Черновик профиля</h2>
              <p className="mt-1 text-sm text-ink-500">
                {hasDraftContent ? "Проверьте данные и исправьте неточности перед публикацией." : "Черновик пока пуст — заполните его вручную или проанализируйте сайт."}
              </p>
            </div>
            {!draftEditorOpen && (
              <button type="button" onClick={() => setDraftEditorOpen(true)} className="shrink-0 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-surface">
                {hasDraftContent ? "Редактировать черновик" : "Заполнить вручную"}
              </button>
            )}
          </div>
          {draftEditorOpen ? (
            <DraftProfileEditor
              profile={profile}
              pending={pending}
              onCancel={() => setDraftEditorOpen(false)}
              onSubmit={(event) => submit(event, saveAnalyzedProfileDraft, () => setDraftEditorOpen(false))}
            />
          ) : hasDraftContent ? (
            <div className="mt-5 space-y-5">
              {profile.summary && <PublishedField label="Краткое описание" value={profile.summary} />}
              <div className="grid gap-5 sm:grid-cols-2">
                <ProfileList title="Оффер" items={profile.offers} />
                <ProfileList title="Целевая аудитория" items={profile.targetAudiences} />
                <ProfileList title="Продукты и тарифы" items={profile.products.map((item) => `${item.name}${item.description ? ` — ${item.description}` : ""}${item.pricing ? ` · ${item.pricing}${item.pricingConfirmed ? " (подтверждено)" : " (нужно подтвердить)"}` : ""}`)} />
                <ProfileList title="Боли и задачи" items={profile.painPoints} />
                <ProfileList title="Отличия" items={profile.differentiators} />
                <ProfileList title="Кейсы и доказательства" items={profile.proof} />
                <ProfileList title="География" items={profile.geography} />
                <ProfileList title="Процесс продажи" items={profile.salesProcess} />
                <ProfileList title="Ограничения" items={profile.restrictions} />
                {profile.tone && <PublishedField label="Тон коммуникации" value={profile.tone} />}
              </div>
            </div>
          ) : null}
        </section>

      {questions.length > 0 && (
        <section className="mt-6 rounded-lg border border-line bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Что нужно уточнить</h2>
          <p className="mt-1 text-sm text-ink-500">Ответы администратора важнее информации на сайте.</p>
          <div className="mt-4 divide-y divide-line">
            {questions.map((question) => <Question key={question.id} question={question} pending={pending} onResult={setResult} refresh={() => router.refresh()} run={startTransition} />)}
          </div>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-slate-300 bg-slate-950 p-5 text-white">
        <h2 className="text-lg font-semibold">Опубликовать профиль</h2>
        <p className="mt-1 text-sm text-slate-300">После публикации новая версия начнёт использоваться в письмах и ответах. Открытые некритичные вопросы этому не мешают.</p>
        {profile.products.some((item) => item.pricing) && (
          <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm">
            <input className="mt-1" type="checkbox" checked={confirmPricing} onChange={(event) => setConfirmPricing(event.target.checked)} />
            <span>Я проверил цены и условия в разделе выше — их можно использовать как актуальные.</span>
          </label>
        )}
        <button disabled={pending || !profile.offers.length || !profile.targetAudiences.length} onClick={() => startTransition(async () => { setResult(await publishProfile(confirmPricing)); router.refresh(); })} className="mt-4 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
          {pending ? "Сохраняем…" : "Опубликовать черновик"}
        </button>
        {setupMode && publishedAt && (
          <a href="/app/setup?s=2" className="ml-3 mt-4 inline-flex rounded-lg border border-slate-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-900">
            Продолжить настройку →
          </a>
        )}
      </section>
      </section>
    </div>
  );
}

function CrawlHistory({
  items,
  pending,
  run,
  onResult,
  refresh,
}: {
  items: CrawlHistoryView[];
  pending: boolean;
  run: React.TransitionStartFunction;
  onResult: (result: ProfileActionResult) => void;
  refresh: () => void;
}) {
  return (
    <details className="group mt-5 rounded-lg border border-line bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:content-none">
        <div>
          <div className="text-sm font-semibold text-slate-900">История анализа сайта</div>
          <div className="mt-0.5 text-xs text-ink-500">Страницы и версии профиля сохраняются. Повторную обработку можно запустить без нового обхода сайта.</div>
        </div>
        <span aria-hidden="true" className="text-lg text-ink-500 transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="divide-y divide-line border-t border-line">
        {items.map((item) => (
          <div key={item.id} className="px-4 py-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {item.profileVersion ? `Версия ${item.profileVersion}` : "Обход без готового профиля"}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.status === "FAILED" ? "bg-red-50 text-red-700" : item.status === "READY_FOR_REVIEW" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                    {STATUS_LABELS[item.status] || item.status}
                  </span>
                </div>
                <div className="metric-number mt-1 text-xs text-ink-500">
                  {new Date(item.synthesizedAt ?? item.createdAt).toLocaleString("ru-RU")} · прочитано {item.crawledCount} · изучено ИИ {item.analyzedCount}
                </div>
                <div className="mt-1 truncate text-xs text-ink-500">{item.rootUrl}</div>
                {item.profile && (
                  <div className="mt-2 text-xs leading-5 text-slate-600">
                    {item.profile.companyName && <span className="font-medium text-slate-800">{item.profile.companyName}. </span>}
                    <span>Офферов: <span className="metric-number">{item.profile.offers.length}</span>, аудиторий: <span className="metric-number">{item.profile.targetAudiences.length}</span>, продуктов: <span className="metric-number">{item.profile.products.length}</span>.</span>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {item.profile && (
                  <button type="button" disabled={pending} onClick={() => run(async () => { onResult(await restoreProfileVersion(item.id)); refresh(); })} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-surface disabled:opacity-50">
                    Восстановить в черновик
                  </button>
                )}
                {item.canRetrySynthesis && (
                  <button type="button" disabled={pending} onClick={() => run(async () => { onResult(await retryProfileSynthesis(item.id)); refresh(); })} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                    Собрать из сохранённых данных
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-sm font-medium text-slate-900">{label}</span>{hint && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}<div className="mt-2">{children}</div></label>;
}

function ProfileList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div><h3 className="text-sm font-semibold text-slate-900">{title}</h3><ul className="mt-2 space-y-1.5 text-sm leading-5 text-slate-600">{items.map((item, index) => <li key={`${title}-${index}`} className="flex gap-2"><span className="text-mint-600">•</span><span>{item}</span></li>)}</ul></div>;
}

function DraftProfileEditor({
  profile,
  pending,
  onCancel,
  onSubmit,
}: {
  profile: BusinessProfileData;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [products, setProducts] = useState(() => profile.products.map((item) => ({ ...item })));

  function updateProduct(index: number, field: "name" | "description" | "pricing", value: string) {
    setProducts((current) => current.map((item, itemIndex) => (
      itemIndex === index
        ? { ...item, [field]: value, ...(field === "pricing" ? { pricingConfirmed: false } : {}) }
        : item
    )));
  }

  return (
    <form className="mt-5 space-y-5 border-t border-line pt-5" onSubmit={onSubmit}>
      <p className="rounded-lg bg-surface px-4 py-3 text-sm text-ink-500">
        После сохранения эти данные считаются подтверждёнными и имеют приоритет при следующем анализе сайта.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Название организации">
          <input className="input" name="companyName" defaultValue={profile.companyName ?? ""} />
        </Field>
        <Field label="Сайт (если есть)">
          <input className="input" name="websiteUrl" type="url" defaultValue={profile.websiteUrl ?? ""} placeholder="https://example.ru" />
        </Field>
      </div>
      <Field label="Краткое описание" hint="Чем занимается компания и какую задачу клиента решает">
        <textarea className="input" name="summary" rows={4} defaultValue={profile.summary} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <ListEditor name="offers" label="Оффер" value={profile.offers} />
        <ListEditor name="targetAudiences" label="Целевая аудитория" value={profile.targetAudiences} />
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Продукты и тарифы</h3>
            <p className="mt-0.5 text-xs text-ink-500">Название, описание и актуальная стоимость каждого предложения.</p>
          </div>
          <button
            type="button"
            disabled={products.length >= 30}
            onClick={() => setProducts((current) => [...current, { name: "", description: "", pricing: "", pricingConfirmed: false, sourceUrl: "" }])}
            className="shrink-0 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-surface disabled:opacity-50"
          >
            Добавить продукт
          </button>
        </div>
        <input type="hidden" name="products" value={JSON.stringify(products)} />
        <div className="mt-3 space-y-3">
          {products.map((product, index) => (
            <div key={`${product.sourceUrl || "product"}-${index}`} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">Продукт {index + 1}</div>
                <button type="button" onClick={() => setProducts((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-xs font-medium text-red-600 hover:text-red-700">
                  Удалить
                </button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Название">
                  <input className="input" value={product.name} onChange={(event) => updateProduct(index, "name", event.target.value)} />
                </Field>
                <Field label="Цена или условия">
                  <input className="input" value={product.pricing} onChange={(event) => updateProduct(index, "pricing", event.target.value)} placeholder="Например, от 15 000 ₽" />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Описание">
                  <textarea className="input" rows={3} value={product.description} onChange={(event) => updateProduct(index, "description", event.target.value)} />
                </Field>
              </div>
            </div>
          ))}
          {!products.length && <p className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-ink-500">Продукты пока не добавлены.</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ListEditor name="painPoints" label="Боли и задачи" value={profile.painPoints} />
        <ListEditor name="differentiators" label="Отличия" value={profile.differentiators} />
        <ListEditor name="proof" label="Кейсы и доказательства" value={profile.proof} />
        <ListEditor name="geography" label="География" value={profile.geography} />
        <ListEditor name="salesProcess" label="Процесс продажи" value={profile.salesProcess} />
        <ListEditor name="restrictions" label="Ограничения" value={profile.restrictions} />
      </div>
      <Field label="Тон коммуникации" hint="Как компания говорит о себе и общается с клиентами">
        <textarea className="input" name="tone" rows={3} defaultValue={profile.tone} />
      </Field>
      <Field label="Дополнительные подтверждённые сведения" hint="Условия, ограничения, терминология и всё, чего может не быть на сайте">
        <textarea className="input" name="manualNotes" rows={4} defaultValue={profile.manualNotes} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <button disabled={pending} className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
          {pending ? "Сохраняем…" : "Сохранить изменения"}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className="rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-surface disabled:opacity-50">
          Отмена
        </button>
      </div>
    </form>
  );
}

function ListEditor({ name, label, value }: { name: string; label: string; value: string[] }) {
  return (
    <Field label={label} hint="По одному пункту с новой строки">
      <textarea className="input" name={name} rows={4} defaultValue={value.join("\n")} />
    </Field>
  );
}

function PublishedProfileDetails({ profile }: { profile: BusinessProfileData }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <PublishedField label="Название организации" value={profile.companyName} />
        <PublishedField label="Сайт" value={profile.websiteUrl} />
        <PublishedField label="Оффер" value={profile.offers.join("\n")} />
        <PublishedField label="Целевая аудитория" value={profile.targetAudiences.join("\n")} />
      </div>
      {profile.summary && <PublishedField label="Краткое описание" value={profile.summary} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <ProfileList title="Продукты и тарифы" items={profile.products.map((item) => `${item.name}${item.description ? ` — ${item.description}` : ""}${item.pricing ? ` · ${item.pricing}` : ""}`)} />
        <ProfileList title="Боли и задачи" items={profile.painPoints} />
        <ProfileList title="Отличия" items={profile.differentiators} />
        <ProfileList title="Кейсы и доказательства" items={profile.proof} />
        <ProfileList title="География" items={profile.geography} />
        <ProfileList title="Процесс продажи" items={profile.salesProcess} />
        <ProfileList title="Ограничения" items={profile.restrictions} />
        {profile.tone && <PublishedField label="Тон коммуникации" value={profile.tone} />}
      </div>
    </div>
  );
}

function PublishedField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return <div><h3 className="text-xs font-medium text-ink-500">{label}</h3><p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-800">{value}</p></div>;
}

function Question({ question, pending, onResult, refresh, run }: { question: QuestionView; pending: boolean; onResult: (result: ProfileActionResult) => void; refresh: () => void; run: React.TransitionStartFunction }) {
  const [answer, setAnswer] = useState(question.answer ?? "");
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2"><div className="text-sm font-semibold text-slate-900">{question.question}</div>{question.critical && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Важно</span>}</div>
      {question.reason && <p className="mt-1 text-xs text-ink-500">{question.reason}</p>}
      <textarea className="input mt-3" rows={2} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Введите подтверждённый ответ" />
      <div className="mt-2 flex gap-3">
        <button disabled={pending} type="button" onClick={() => run(async () => { onResult(await answerProfileQuestion(question.id, answer)); refresh(); })} className="text-sm font-semibold text-slate-900 disabled:opacity-50">Сохранить ответ</button>
        <button disabled={pending} type="button" onClick={() => run(async () => { onResult(await answerProfileQuestion(question.id, "")); refresh(); })} className="text-sm text-ink-500 disabled:opacity-50">Пропустить</button>
      </div>
    </div>
  );
}
