"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import {
  createCampaign,
  generateVariants,
  loadPreset,
  saveAsTemplate,
  saveBrand,
} from "./actions";
import { wrapInBrandShell, type Brand } from "@/lib/mail/brandShell";

/**
 * Мастер кампании (UX TO BE, R3): 3 шага вместо формы-простыни.
 *   1. Кому — сегмент + название (2 поля).
 *   2. Письмо — ИИ генерит варианты САМ при входе на шаг; выбор карточкой,
 *      правка инлайн; «Оформление» — фирменный HTML-каркас (бренд-цвет +
 *      логотип) и галерея готовых шаблонов (бывшая вкладка «Шаблоны»).
 *   3. Запуск — follow-up ВКЛЮЧЁН по умолчанию; A/B и расписание — в
 *      «продвинутом»; выбора LLM-модели больше нет.
 *
 * Все шаги живут в одной <form> и скрываются через hidden — значения
 * не теряются, сабмит собирает всё разом (createCampaign не менялся).
 */

type Variant = { subject: string; body: string };

// Демо-подстановка переменных для предпросмотра (реальные значения — при отправке).
function demoRender(t: string): string {
  return t
    .replace(/\{\{\s*name\s*\}\}/g, "Пётр")
    .replace(/\{\{\s*company\s*\}\}/g, "ООО «Ромашка»")
    .replace(/\{\{\s*\w+\s*\}\}/g, "#");
}

function previewSrcDoc(body: string, isHtml: boolean): string {
  const rendered = demoRender(body);
  if (isHtml) return rendered;
  const esc = rendered.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.65;color:#334155;white-space:pre-wrap;padding:20px;">${esc}</div>`;
}

export function NewCampaignForm({
  segments,
  onboardingDone,
  initialPreset,
  presets,
  userTemplates,
  brand: initialBrand,
}: {
  segments: string[];
  onboardingDone: boolean;
  initialPreset?: string | null;
  presets: { key: string; name: string }[];
  userTemplates: { id: string; name: string }[];
  brand: Brand;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [segment, setSegment] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [chosen, setChosen] = useState(-1);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isHtml, setIsHtml] = useState(false);
  const [decor, setDecor] = useState<"none" | "brand">("none");
  const [brandColor, setBrandColor] = useState(initialBrand.color || "#22a88d");
  const [brandLogoUrl, setBrandLogoUrl] = useState(initialBrand.logoUrl || "");
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const generatedOnce = useRef(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // совместимость со старыми ссылками ?preset= (лендинг и т.п.)
  useEffect(() => {
    if (initialPreset) {
      loadPreset(initialPreset).then((p) => {
        if (p) {
          setSubject(p.subject);
          setBody(p.html);
          setIsHtml(p.isHtml);
          generatedOnce.current = true; // пресет выбран — автогенерацию не запускаем
        }
      });
    }
  }, [initialPreset]);

  // шаг 2: ИИ пишет варианты САМ при первом входе (кнопки «сгенерировать» нет)
  useEffect(() => {
    if (step !== 2 || generatedOnce.current || body) return;
    generatedOnce.current = true;
    startTransition(async () => {
      const { variants: v, notice } = await generateVariants();
      setVariants(v);
      if (v[0]) {
        setChosen(0);
        setSubject(v[0].subject);
        setBody(v[0].body);
      }
      if (notice) setToast(notice);
    });
  }, [step, body]);

  function regenerate() {
    startTransition(async () => {
      const { variants: v, notice } = await generateVariants();
      setVariants(v);
      if (notice) setToast(notice);
    });
  }

  function pickVariant(i: number) {
    setChosen(i);
    setSubject(variants[i].subject);
    setBody(variants[i].body);
    setIsHtml(false);
    setDecor("none");
  }

  function usePreset(key: string) {
    startTransition(async () => {
      const p = await loadPreset(key);
      if (p) {
        setSubject(p.subject);
        setBody(p.html);
        setIsHtml(p.isHtml);
        setDecor("none");
        setChosen(-1);
      }
    });
  }

  function handleSaveBrand() {
    startTransition(async () => {
      await saveBrand({ brandColor, brandLogoUrl });
      setToast("Бренд сохранён — применится ко всем фирменным письмам");
    });
  }

  function handleSaveTemplate() {
    const tplName = window.prompt("Название шаблона:", subject || "Мой шаблон");
    if (!tplName) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("name", tplName);
      fd.set("subject", subject);
      fd.set("body", finalBody());
      if (finalIsHtml()) fd.set("isHtml", "on");
      const res = await saveAsTemplate(fd);
      setToast(res.error ?? "Шаблон сохранён — найдёте его в «Оформлении»");
    });
  }

  // итоговое тело: с фирменным каркасом или как есть
  const brand: Brand = { color: brandColor, logoUrl: brandLogoUrl, companyName: initialBrand.companyName };
  const finalBody = () => (decor === "brand" && !isHtml ? wrapInBrandShell(body, brand) : body);
  const finalIsHtml = () => (decor === "brand" && !isHtml ? true : isHtml);

  const canNext1 = name.trim().length > 0;
  const canNext2 = subject.trim().length > 0 && body.trim().length > 0;

  const stepChip = (n: number, label: string) => (
    <button
      type="button"
      key={n}
      onClick={() => {
        if (n < step) setStep(n);
        if (n === 2 && step === 1 && canNext1) setStep(2);
        if (n === 3 && step === 2 && canNext2) setStep(3);
      }}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
        step === n
          ? "brand-gradient text-white"
          : n < step
            ? "border border-mint-400 bg-mint-100/40 text-mint-700"
            : "border border-line bg-white text-ink-500"
      }`}
    >
      {n < step ? "✓ " : `${n} `}
      {label}
    </button>
  );

  return (
    <form action={createCampaign}>
      {toast && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-lg"
        >
          <div className="flex items-start gap-2">
            <div className="flex-1">{toast}</div>
            <button type="button" onClick={() => setToast(null)} className="text-amber-600 hover:text-amber-900" aria-label="Закрыть уведомление">
              ×
            </button>
          </div>
        </div>
      )}

      {/* шаги */}
      <div className="flex flex-wrap gap-2">
        {stepChip(1, "Кому")}
        {stepChip(2, "Письмо")}
        {stepChip(3, "Запуск")}
      </div>

      {/* синхронизация с сабмитом: итоговые тема/тело/флаг HTML */}
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="body" value={finalBody()} />
      {finalIsHtml() && <input type="hidden" name="isHtml" value="on" />}

      {/* ── Шаг 1: Кому ── */}
      <div hidden={step !== 1} className="mt-6 max-w-xl space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Название кампании</span>
          <input
            name="name"
            className="input mt-2"
            placeholder="Холодная база — юристы"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Кому отправляем</span>
          <select name="segment" className="input mt-2" value={segment} onChange={(e) => setSegment(e.target.value)}>
            <option value="">Все контакты</option>
            {segments.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!canNext1}
          onClick={() => setStep(2)}
          className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          Дальше: письмо →
        </button>
      </div>

      {/* ── Шаг 2: Письмо ── */}
      <div hidden={step !== 2} className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {!onboardingDone && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Заполните данные о бизнесе в Настройках — письма ИИ будут точнее.
            </p>
          )}

          {/* варианты ИИ */}
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full brand-gradient text-[10px] font-bold text-white">AI</span>
                <span className="text-sm font-semibold text-slate-900">
                  {pending && variants.length === 0 ? "ИИ пишет варианты…" : "Варианты письма"}
                </span>
              </div>
              <button
                type="button"
                onClick={regenerate}
                disabled={pending}
                className="text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-50"
              >
                ↻ ещё варианты
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {variants.map((v, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => pickVariant(i)}
                  className={`block w-full rounded-lg border p-3 text-left text-xs transition ${
                    chosen === i ? "border-mint-400 bg-mint-100/30" : "border-line bg-white hover:border-mint-400"
                  }`}
                >
                  <div className="font-semibold text-slate-900">
                    {chosen === i ? "✓ " : ""}Вариант {i + 1}: {v.subject}
                  </div>
                  <div className="mt-1 line-clamp-2 text-ink-500">{v.body.replace(/<[^>]+>/g, " ").slice(0, 160)}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-900">Тема письма</span>
            <input className="input mt-2" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-900">Текст письма</span>
            <span className="mt-0.5 block text-xs text-ink-500">
              Переменные: {"{{name}}"}, {"{{company}}"}, {"{{cta_url}}"}
            </span>
            <textarea
              rows={isHtml ? 14 : 10}
              className="input mt-2 font-mono text-xs"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>

          {/* Оформление: фирменный каркас + галерея шаблонов (бывшая вкладка) */}
          <details className="rounded-xl border border-line bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">
              🎨 Оформление {decor === "brand" ? "· фирменное письмо" : "· без оформления"}
            </summary>
            <div className="mt-3 space-y-4">
              {!isHtml && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDecor("none")}
                    className={`rounded-lg border px-4 py-2 text-sm ${decor === "none" ? "border-mint-400 bg-mint-100/40 font-semibold" : "border-line"}`}
                  >
                    Просто текст
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecor("brand")}
                    className={`rounded-lg border px-4 py-2 text-sm ${decor === "brand" ? "border-mint-400 bg-mint-100/40 font-semibold" : "border-line"}`}
                  >
                    Фирменное письмо (HTML)
                  </button>
                </div>
              )}
              {decor === "brand" && !isHtml && (
                <div className="flex flex-wrap items-end gap-3 rounded-lg bg-surface p-3">
                  <label className="block">
                    <span className="text-xs font-medium text-ink-500">Цвет бренда</span>
                    <input
                      type="color"
                      value={brandColor}
                      onChange={(e) => setBrandColor(e.target.value)}
                      className="mt-1 block h-9 w-16 cursor-pointer rounded border border-line"
                    />
                  </label>
                  <label className="block flex-1">
                    <span className="text-xs font-medium text-ink-500">Логотип (URL, по желанию)</span>
                    <input
                      value={brandLogoUrl}
                      onChange={(e) => setBrandLogoUrl(e.target.value)}
                      placeholder="https://…/logo.png"
                      className="input mt-1 !py-1.5 text-xs"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleSaveBrand}
                    disabled={pending}
                    className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink-700 hover:border-mint-400"
                  >
                    Сохранить бренд
                  </button>
                </div>
              )}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Или начать с готового шаблона
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {presets.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => usePreset(p.key)}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-700 hover:border-mint-400"
                    >
                      {p.name}
                    </button>
                  ))}
                  {userTemplates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => usePreset(`tpl:${t.id}`)}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700"
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                {isHtml && (
                  <button
                    type="button"
                    onClick={() => { setIsHtml(false); setDecor("none"); setBody(""); setChosen(-1); }}
                    className="mt-2 text-xs text-ink-500 underline hover:text-slate-900"
                  >
                    ← вернуться к текстовому письму
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={pending || !subject || !body}
                className="text-xs text-ink-500 underline hover:text-slate-900 disabled:opacity-50"
              >
                Сохранить текущее письмо как шаблон
              </button>
            </div>
          </details>

          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(1)} className="rounded-lg border border-line px-5 py-3 text-sm font-semibold text-ink-700">
              ← Назад
            </button>
            <button
              type="button"
              disabled={!canNext2}
              onClick={() => setStep(3)}
              className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Дальше: запуск →
            </button>
          </div>
        </div>

        {/* живой предпросмотр */}
        <aside>
          {body && (
            <div className="rounded-xl border border-line bg-white p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Предпросмотр</div>
              <div className="mb-2 rounded-lg bg-surface px-3 py-2 text-sm">
                <span className="text-ink-500">Тема:</span>{" "}
                <span className="font-medium text-slate-900">{demoRender(subject) || "—"}</span>
              </div>
              <iframe
                key={`${decor}:${brandColor}:${brandLogoUrl}:${isHtml}:${body.length}:${subject.length}`}
                srcDoc={previewSrcDoc(finalBody(), finalIsHtml())}
                title="preview"
                className="h-96 w-full rounded-lg border border-line"
              />
              <p className="mt-2 text-xs text-ink-500">
                Показано с примерными данными («Пётр», «ООО Ромашка»).
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* ── Шаг 3: Запуск ── */}
      <div hidden={step !== 3} className="mt-6 max-w-xl space-y-4">
        {/* follow-up: включён по умолчанию с готовыми дефолтами */}
        <div className="rounded-xl border border-line bg-white p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" name="followupEnabled" defaultChecked />
            Follow-up: дослать письмо, если нет ответа
          </label>
          <div className="mt-2 flex items-center gap-2 text-sm text-ink-700">
            через
            <input name="followupDays" type="number" defaultValue={3} min={1} max={30} className="input !w-20 !py-1.5" />
            дня. Текст — «Хотел уточнить, актуально ли моё предложение?» (можно изменить в «продвинутом»).
          </div>
        </div>

        <details className="rounded-xl border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Продвинутое: A/B-тест, свой follow-up, расписание</summary>
          <div className="mt-3 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <input type="checkbox" name="abEnabled" />
              A/B-тест: второй вариант письма
            </label>
            <input name="subjectB" className="input" placeholder="Тема (вариант B)" />
            <textarea name="bodyB" rows={4} className="input font-mono text-xs" placeholder="Текст варианта B" />
            <input name="followupSubject" className="input" placeholder="Тема follow-up (по умолчанию Re: …)" />
            <textarea name="followupBody" rows={3} className="input font-mono text-xs" placeholder="Свой текст follow-up" />
            <label className="block text-sm text-ink-700">
              Отложенный запуск:
              <input name="scheduledAt" type="datetime-local" className="input mt-1" />
            </label>
          </div>
        </details>

        <div className="flex gap-3">
          <button type="button" onClick={() => setStep(2)} className="rounded-lg border border-line px-5 py-3 text-sm font-semibold text-ink-700">
            ← Назад
          </button>
          <button className="rounded-lg brand-gradient px-8 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-90">
            Создать кампанию
          </button>
        </div>
        <p className="text-xs text-ink-500">
          После создания откроется карточка кампании — запуск оттуда (или
          автоматически после прогрева ящиков).
        </p>
      </div>
    </form>
  );
}
