"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import {
  createCampaign,
  generateVariants,
  loadPreset,
  saveAsTemplate,
  saveBrand,
  generateEmailImage,
  imageQuota,
} from "./actions";
import { wrapInBrandShell, FONT_OPTIONS, type Brand } from "@/lib/mail/brandShell";

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
  // несколько сегментов = несколько кампаний (по одной на сегмент)
  const [chosenSegments, setChosenSegments] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [chosen, setChosen] = useState(-1);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isHtml, setIsHtml] = useState(false);
  const [decor, setDecor] = useState<"none" | "brand">("none");
  // дефолт цвета — нейтральный слейт, НЕ фирменный изумруд Smailee: письмо
  // уходит от имени клиента, наш бренд в нём неуместен
  const [brandColor, setBrandColor] = useState(initialBrand.color || "#334155");
  const [brandLogoUrl, setBrandLogoUrl] = useState(initialBrand.logoUrl || "");
  const [brandFont, setBrandFont] = useState(initialBrand.font || "system");
  const [brandSignature, setBrandSignature] = useState(initialBrand.signature || "");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [quota, setQuota] = useState<{ usedToday: number; limit: number; live: boolean } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewWide, setPreviewWide] = useState(true);
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
      const { variants: v, notice } = await generateVariants({
        segment: chosenSegments[0] ?? null,
      });
      setVariants(v);
      if (v[0]) {
        setChosen(0);
        setSubject(v[0].subject);
        setBody(v[0].body);
      }
      if (notice) setToast(notice);
    });
    // chosenSegments намеренно не в зависимостях: автогенерация — разовая,
    // при смене сегмента перегенерируем по кнопке, а не молча под руками
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, body]);

  // Перегенерация с замечаниями: без них «ещё варианты» — просто новая
  // случайная попытка, и та же претензия к тексту остаётся из раза в раз.
  function regenerate() {
    startTransition(async () => {
      const { variants: v, notice } = await generateVariants({
        feedback: feedback.trim() || null,
        previous: subject || body ? { subject, body } : null,
        segment: chosenSegments[0] ?? null,
      });
      setVariants(v);
      if (notice) setToast(notice);
      if (feedback.trim() && v.length > 0) {
        // правки учтены — поле очищаем, иначе они молча применятся ещё раз
        setFeedback("");
        setToast("Варианты перегенерированы с учётом ваших правок");
      }
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
      await saveBrand({ brandColor, brandLogoUrl, brandFont, brandSignature });
      setToast("Оформление сохранено — применится ко всем фирменным письмам");
    });
  }

  // остаток дневного лимита картинок подтягиваем при раскрытии оформления
  useEffect(() => {
    if (decor !== "brand" || quota) return;
    imageQuota().then(setQuota).catch(() => {});
  }, [decor, quota]);

  function handleGenerateImage() {
    startTransition(async () => {
      const res = await generateEmailImage(imagePrompt);
      setQuota((q) => (q ? { ...q, usedToday: res.usedToday, limit: res.limit } : q));
      if (res.error) {
        setToast(res.error);
        return;
      }
      if (res.url) {
        setImageUrl(res.url);
        // вставляем в конец текста — точное место пользователь выберет сам,
        // угадывать его в свободном тексте мы не можем
        setBody((b) => `${b}\n\n<img src="${res.url}" alt="" style="max-width:100%;border-radius:12px;">`);
        setToast(res.mocked ? "Показана демо-картинка (нет ключа fal.ai)" : "Картинка добавлена в письмо");
      }
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

  // итоговое тело: с фирменным каркасом или как есть.
  // poweredBy приходит из initialBrand (решается на сервере по тарифу) —
  // иначе предпросмотр и реальное письмо разошлись бы по наличию плашки.
  const brand: Brand = {
    color: brandColor,
    logoUrl: brandLogoUrl,
    companyName: initialBrand.companyName,
    font: brandFont,
    signature: brandSignature,
    poweredBy: initialBrand.poweredBy,
  };
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
        <div className="block">
          <span className="text-sm font-medium text-slate-900">Кому отправляем</span>
          {segments.length === 0 ? (
            <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-ink-500">
              Сегментов пока нет — письма уйдут по всей базе. Сегменты задаются
              при загрузке контактов.
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-ink-500">
                Можно выбрать несколько — на каждый сегмент создастся отдельная
                кампания со своей статистикой. Ничего не выбрано — одна кампания
                по всей базе.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {segments.map((s) => {
                  const active = chosenSegments.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        setChosenSegments((prev) =>
                          active ? prev.filter((x) => x !== s) : [...prev, s]
                        )
                      }
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        active
                          ? "border-mint-400 bg-mint-100/40 font-semibold text-mint-700"
                          : "border-line text-ink-700 hover:border-mint-400"
                      }`}
                    >
                      {active ? "✓ " : ""}
                      {s}
                    </button>
                  );
                })}
              </div>
              {chosenSegments.map((s) => (
                <input key={s} type="hidden" name="segments" value={s} />
              ))}
              {chosenSegments.length > 1 && (
                <p className="mt-2 rounded-lg bg-mint-100/40 px-3 py-2 text-xs text-mint-700">
                  Будет создано кампаний: {chosenSegments.length}. Названия
                  проставим автоматически по сегменту и дате.
                </p>
              )}
            </>
          )}
        </div>
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
                {pending ? "…" : feedback.trim() ? "↻ переписать с правками" : "↻ ещё варианты"}
              </button>
            </div>

            {/* правки к тексту: что именно не так с текущими вариантами */}
            <div className="mt-3">
              <textarea
                rows={2}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Что поправить? Напр.: короче, без «инновационных решений», добавить про сроки внедрения"
                className="input w-full text-xs"
              />
              <p className="mt-1 text-xs text-ink-500">
                Оставьте пустым — получите просто другие варианты. С правками ИИ
                доработает текущий текст, а не напишет с нуля.
              </p>
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
                <div className="space-y-3 rounded-lg bg-surface p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block">
                      <span className="text-xs font-medium text-ink-500">Цвет бренда</span>
                      <input
                        type="color"
                        value={brandColor}
                        onChange={(e) => setBrandColor(e.target.value)}
                        className="mt-1 block h-9 w-16 cursor-pointer rounded border border-line"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-ink-500">Шрифт письма</span>
                      <select
                        value={brandFont}
                        onChange={(e) => setBrandFont(e.target.value)}
                        className="input mt-1 !py-1.5 text-xs"
                      >
                        {FONT_OPTIONS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block flex-1">
                      <span className="text-xs font-medium text-ink-500">Логотип (URL)</span>
                      <input
                        value={brandLogoUrl}
                        onChange={(e) => setBrandLogoUrl(e.target.value)}
                        placeholder="https://…/logo.png"
                        className="input mt-1 !py-1.5 text-xs"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-xs font-medium text-ink-500">
                      Подпись в конце письма
                    </span>
                    <textarea
                      rows={3}
                      value={brandSignature}
                      onChange={(e) => setBrandSignature(e.target.value)}
                      placeholder={"Иван Иванов\nДиректор, ООО «Ромашка»\n+7 900 000-00-00 · romashka.ru"}
                      className="input mt-1 text-xs"
                    />
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveBrand}
                      disabled={pending}
                      className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-ink-700 hover:border-mint-400"
                    >
                      Сохранить оформление
                    </button>
                    <span className="text-xs text-ink-500">
                      Применится ко всем будущим кампаниям
                    </span>
                  </div>

                  {/* генерация картинки для письма */}
                  <div className="border-t border-line pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-ink-500">Картинка в письмо</span>
                      {quota && (
                        <span className="text-[11px] text-ink-500">
                          {quota.usedToday} из {quota.limit} за сутки
                          {!quota.live && " · демо-режим"}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex gap-2">
                      <input
                        value={imagePrompt}
                        onChange={(e) => setImagePrompt(e.target.value)}
                        placeholder="Что нарисовать: напр. «команда в офисе обсуждает график продаж»"
                        className="input flex-1 !py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={handleGenerateImage}
                        disabled={pending || !imagePrompt.trim()}
                        className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-mint-400 disabled:opacity-50"
                      >
                        Сгенерировать
                      </button>
                    </div>
                    {imageUrl && (
                      <div className="mt-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imageUrl} alt="" className="max-h-40 rounded-lg border border-line" />
                        <p className="mt-1 text-[11px] text-ink-500">
                          Картинка добавлена в конец письма — подвиньте тег
                          &lt;img&gt; в тексте, если нужно другое место.
                        </p>
                      </div>
                    )}
                  </div>
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
            <div className="sticky top-4 rounded-xl border border-line bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Предпросмотр</span>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="text-xs font-semibold text-indigo-600 hover:underline"
                >
                  Развернуть ⤢
                </button>
              </div>
              <div className="mb-2 rounded-lg bg-surface px-3 py-2 text-sm">
                <span className="text-ink-500">Тема:</span>{" "}
                <span className="font-medium text-slate-900">{demoRender(subject) || "—"}</span>
              </div>
              <iframe
                key={`${decor}:${brandColor}:${brandLogoUrl}:${isHtml}:${body.length}:${subject.length}`}
                srcDoc={previewSrcDoc(finalBody(), finalIsHtml())}
                title="preview"
                className="h-[32rem] w-full rounded-lg border border-line"
              />
              <p className="mt-2 text-xs text-ink-500">
                Показано с примерными данными («Пётр», «ООО Ромашка»).
              </p>
            </div>
          )}
        </aside>

        {/* предпросмотр во весь экран — в узкой колонке письмо выглядит иначе,
            чем в почте у получателя */}
        {previewOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
            onClick={() => setPreviewOpen(false)}
          >
            <div
              className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">Предпросмотр письма</div>
                  <div className="truncate text-xs text-ink-500">Тема: {demoRender(subject) || "—"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg border border-line p-0.5">
                    {(
                      [
                        { v: true, label: "Десктоп" },
                        { v: false, label: "Телефон" },
                      ] as const
                    ).map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        onClick={() => setPreviewWide(o.v)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                          previewWide === o.v ? "bg-surface text-slate-900" : "text-ink-500 hover:text-slate-900"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    className="rounded-lg border border-line px-3 py-1 text-xs font-medium text-ink-500 hover:text-slate-900"
                  >
                    Закрыть
                  </button>
                </div>
              </div>
              <div className="flex flex-1 justify-center overflow-auto bg-surface p-4">
                <iframe
                  srcDoc={previewSrcDoc(finalBody(), finalIsHtml())}
                  title="preview-full"
                  className={`h-full rounded-lg border border-line bg-white ${previewWide ? "w-full" : "w-[390px]"}`}
                />
              </div>
            </div>
          </div>
        )}
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
