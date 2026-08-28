"use client";

import { useState, useTransition } from "react";
import { createCampaign, generateVariants } from "./actions";
import { MAX_FOLLOWUP_STEPS, type FollowupStepInput } from "@/lib/campaigns/followupSteps";

type Variant = { subject: string; body: string };

export function NewCampaignForm({
  segments,
  onboardingDone,
}: {
  segments: string[];
  onboardingDone: boolean;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [chosenSegments, setChosenSegments] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [segmentTexts, setSegmentTexts] = useState<Record<string, Variant>>({});
  const [activeSegment, setActiveSegment] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [followupEnabled, setFollowupEnabled] = useState(false);
  const [followupSteps, setFollowupSteps] = useState<FollowupStepInput[]>([]);
  const [pending, startTransition] = useTransition();

  const multiSegment = chosenSegments.length > 1;
  const canNext1 = Boolean(name.trim());
  const currentSegmentTexts =
    multiSegment && activeSegment
      ? { ...segmentTexts, [activeSegment]: { subject, body } }
      : segmentTexts;
  const segmentsReady = multiSegment
    ? chosenSegments.every((segment) => {
        const text = currentSegmentTexts[segment];
        return Boolean(text?.subject.trim() && text.body.trim());
      })
    : Boolean(subject.trim() && body.trim());

  function selectSegments(segment: string) {
    setChosenSegments((current) =>
      current.includes(segment) ? current.filter((item) => item !== segment) : [...current, segment]
    );
  }

  function switchSegment(next: string) {
    if (next === activeSegment) return;
    if (activeSegment) {
      setSegmentTexts((current) => ({ ...current, [activeSegment]: { subject, body } }));
    }
    const nextText = segmentTexts[next];
    setActiveSegment(next);
    setSubject(nextText?.subject ?? "");
    setBody(nextText?.body ?? "");
    setVariants([]);
  }

  function generateText() {
    startTransition(async () => {
      const result = await generateVariants({
        feedback: feedback.trim() || null,
        previous: subject || body ? { subject, body } : null,
        segment: multiSegment ? activeSegment : (chosenSegments[0] ?? null),
        count: multiSegment ? 1 : 2,
      });
      if (result.error) {
        setNotice(result.error);
        return;
      }
      if (result.notice) setNotice(result.notice);
      if (multiSegment) {
        const variant = result.variants[0];
        if (!variant || !activeSegment) return;
        setSubject(variant.subject);
        setBody(variant.body);
        setSegmentTexts((current) => ({ ...current, [activeSegment]: variant }));
      } else {
        setVariants(result.variants);
        const first = result.variants[0];
        if (first) {
          setSubject(first.subject);
          setBody(first.body);
        }
      }
    });
  }

  function chooseVariant(variant: Variant) {
    setSubject(variant.subject);
    setBody(variant.body);
  }

  function continueToLetter() {
    if (!canNext1) return;
    if (chosenSegments.length > 1 && !activeSegment) {
      const first = chosenSegments[0];
      setActiveSegment(first);
      setSubject(segmentTexts[first]?.subject ?? "");
      setBody(segmentTexts[first]?.body ?? "");
    }
    setStep(2);
  }

  function continueToLaunch() {
    if (!segmentsReady) return;
    if (multiSegment && activeSegment) {
      setSegmentTexts((current) => ({ ...current, [activeSegment]: { subject, body } }));
    }
    setStep(3);
  }

  function addFollowup() {
    if (followupSteps.length >= MAX_FOLLOWUP_STEPS) return;
    setFollowupSteps((steps) => [
      ...steps,
      { daysAfterPrevious: 3, subject: `Re: ${subject}`, body: "" },
    ]);
  }

  function updateFollowup(index: number, patch: Partial<FollowupStepInput>) {
    setFollowupSteps((steps) => steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  const stepButton = (number: number, label: string) => (
    <button
      type="button"
      onClick={() => {
        if (number < step) setStep(number);
      }}
      className={`rounded-full px-4 py-1.5 text-sm font-medium ${
        step === number
          ? "brand-gradient text-white"
          : number < step
            ? "border border-mint-400 bg-mint-100/40 text-mint-700"
            : "border border-line bg-white text-ink-500"
      }`}
    >
      {number < step ? "✓ " : `${number} `}
      {label}
    </button>
  );

  return (
    <form action={createCampaign}>
      {notice && (
        <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="font-semibold" aria-label="Закрыть уведомление">×</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {stepButton(1, "Кому")}
        {stepButton(2, "Письмо")}
        {stepButton(3, "Запуск")}
      </div>

      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="body" value={body} />
      {multiSegment && <input type="hidden" name="segmentTexts" value={JSON.stringify(currentSegmentTexts)} />}

      <div hidden={step !== 1} className="mt-6 max-w-xl space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Название кампании</span>
          <input name="name" value={name} onChange={(event) => setName(event.target.value)} required className="input mt-2" placeholder="Холодная база — юристы" />
        </label>

        <div>
          <span className="text-sm font-medium text-slate-900">Кому отправляем</span>
          {segments.length === 0 ? (
            <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-ink-500">Сегментов пока нет — письмо уйдёт по всей активной базе.</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-ink-500">Можно выбрать несколько: для каждого сегмента создастся отдельная кампания.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {segments.map((segment) => {
                  const selected = chosenSegments.includes(segment);
                  return (
                    <button key={segment} type="button" onClick={() => selectSegments(segment)} className={`rounded-lg border px-3 py-1.5 text-sm ${selected ? "border-mint-400 bg-mint-100/40 font-semibold text-mint-700" : "border-line text-ink-700"}`}>
                      {selected ? "✓ " : ""}{segment}
                    </button>
                  );
                })}
              </div>
              {chosenSegments.map((segment) => <input key={segment} type="hidden" name="segments" value={segment} />)}
            </>
          )}
        </div>

        <button type="button" disabled={!canNext1} onClick={continueToLetter} className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">Дальше: письмо →</button>
      </div>

      <div hidden={step !== 2} className="mt-6 max-w-2xl space-y-4">
        {!onboardingDone && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Заполните данные о бизнесе в настройках — ИИ сможет точнее подготовить письмо.</p>}

        {multiSegment && (
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="text-sm font-semibold text-slate-900">Отдельный текст для каждого сегмента</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {chosenSegments.map((segment) => {
                const text = currentSegmentTexts[segment];
                const complete = Boolean(text?.subject.trim() && text.body.trim());
                return <button key={segment} type="button" onClick={() => switchSegment(segment)} className={`rounded-lg border px-3 py-1.5 text-sm ${segment === activeSegment ? "border-mint-400 bg-mint-100/40 font-semibold text-mint-700" : "border-line text-ink-700"}`}>{complete ? "✓ " : ""}{segment}</button>;
              })}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Текст письма от ИИ</p>
              <p className="mt-1 text-xs text-ink-500">Письмо остаётся обычным текстом: без HTML-шаблонов, оформления и картинок.</p>
            </div>
            <button type="button" onClick={generateText} disabled={pending} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 disabled:opacity-50">{pending ? "ИИ пишет…" : "Сгенерировать"}</button>
          </div>
          <textarea rows={2} value={feedback} onChange={(event) => setFeedback(event.target.value)} className="input mt-3 text-xs" placeholder="Что поправить? Например: короче, добавить цифры, без канцелярита" />
          {!multiSegment && variants.length > 0 && (
            <div className="mt-3 space-y-2">
              {variants.map((variant, index) => <button key={index} type="button" onClick={() => chooseVariant(variant)} className="block w-full rounded-lg border border-line bg-white p-3 text-left text-xs hover:border-mint-400"><span className="font-semibold text-slate-900">Вариант {index + 1}: {variant.subject}</span><span className="mt-1 block line-clamp-2 text-ink-500">{variant.body}</span></button>)}
            </div>
          )}
        </div>

        <label className="block"><span className="text-sm font-medium text-slate-900">Тема письма</span><input value={subject} onChange={(event) => setSubject(event.target.value)} className="input mt-2" required /></label>
        <label className="block"><span className="text-sm font-medium text-slate-900">Текст письма</span><span className="mt-1 block text-xs text-ink-500">Переменные: {"{{greeting}}"}, {"{{company_observation}}"}, {"{{cta_url}}"}</span><textarea rows={12} value={body} onChange={(event) => setBody(event.target.value)} className="input mt-2 font-mono text-xs" required /></label>

        <div className="flex gap-3"><button type="button" onClick={() => setStep(1)} className="rounded-lg border border-line px-5 py-3 text-sm font-semibold text-ink-700">← Назад</button><button type="button" disabled={!segmentsReady} onClick={continueToLaunch} className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">Дальше: запуск →</button></div>
      </div>

      <div hidden={step !== 3} className="mt-6 max-w-xl space-y-4">
        <input type="hidden" name="followupSteps" value={JSON.stringify(followupSteps)} />
        <div className="rounded-xl border border-line bg-white p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900"><input type="checkbox" name="followupEnabled" checked={followupEnabled} onChange={(event) => setFollowupEnabled(event.target.checked)} />Follow-up: написать, если нет ответа</label>
          {followupEnabled && <div className="mt-3 space-y-3">
            {followupSteps.map((item, index) => <div key={index} className="rounded-lg border border-line bg-surface p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-900">Письмо {index + 2}</span><button type="button" onClick={() => setFollowupSteps((steps) => steps.filter((_, i) => i !== index))} className="text-xs text-ink-500">Убрать</button></div><label className="mt-2 flex items-center gap-2 text-xs text-ink-700">через <input type="number" min={1} max={30} value={item.daysAfterPrevious} onChange={(event) => updateFollowup(index, { daysAfterPrevious: Number(event.target.value) || 1 })} className="input !w-16 !py-1" /> дней</label><input value={item.subject} onChange={(event) => updateFollowup(index, { subject: event.target.value })} className="input mt-2 !py-1.5 text-xs" placeholder="Тема" /><textarea value={item.body} onChange={(event) => updateFollowup(index, { body: event.target.value })} rows={3} className="input mt-2 text-xs" placeholder="Текст письма" /></div>)}
            {followupSteps.length < MAX_FOLLOWUP_STEPS && <button type="button" onClick={addFollowup} className="text-xs font-semibold text-indigo-600">+ добавить письмо</button>}
          </div>}
        </div>

        <div className="rounded-xl border border-line bg-white p-4"><label className="flex items-center gap-2 text-sm font-medium text-slate-900"><input type="checkbox" name="trackingEnabled" />Отслеживать открытия (Open Rate)</label><p className="mt-2 text-xs text-ink-500">К текстовому письму добавится минимальная HTML-версия только с пикселем открытия. Ссылки не подменяются и клики не отслеживаются.</p></div>

        <details className="rounded-xl border border-line bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-900">Продвинутое: A/B-тест и расписание</summary><div className="mt-3 space-y-3"><label className="flex items-center gap-2 text-sm font-medium text-slate-900"><input type="checkbox" name="abEnabled" />A/B-тест: второй вариант письма</label><input name="subjectB" className="input" placeholder="Тема варианта B" /><textarea name="bodyB" rows={4} className="input text-xs" placeholder="Текст варианта B" /><label className="block text-sm text-ink-700">Отложенный запуск:<input name="scheduledAt" type="datetime-local" className="input mt-1" /></label></div></details>

        <div className="flex gap-3"><button type="button" onClick={() => setStep(2)} className="rounded-lg border border-line px-5 py-3 text-sm font-semibold text-ink-700">← Назад</button><button className="rounded-lg brand-gradient px-8 py-3 text-sm font-semibold text-white">Создать кампанию</button></div>
      </div>
    </form>
  );
}
