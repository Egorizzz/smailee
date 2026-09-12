"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createCampaign, generateVariants, previewPersonalizedEmailForRecipient, previewPersonalizedEmails } from "./actions";
import { MAX_FOLLOWUP_STEPS, type FollowupStepInput } from "@/lib/campaigns/followupSteps";
import type { CampaignSegmentPreview } from "@/lib/campaigns/segmentPreviews";
import { PERSONALIZED_PREVIEW_PERSISTED_MAX, type CampaignPersonalizedPreviewItem, type CampaignPreviewRecipient } from "@/lib/campaigns/personalizedPreview";

type Variant = { subject: string; body: string };

export function NewCampaignForm({
  segments,
  segmentPreviews,
  onboardingDone,
  onboarding = false,
  controlAddress = null,
  defaultScheduledAt,
  defaultTimezoneOffset,
}: {
  segments: string[];
  segmentPreviews: CampaignSegmentPreview[];
  onboardingDone: boolean;
  onboarding?: boolean;
  controlAddress?: { email: string; name: string | null } | null;
  defaultScheduledAt: string;
  defaultTimezoneOffset: number;
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
  const [recipientScope, setRecipientScope] = useState<"contacts" | "control" | "all">("all");
  const [preview, setPreview] = useState<CampaignSegmentPreview | null>(null);
  const [personalizedPreviews, setPersonalizedPreviews] = useState<CampaignPersonalizedPreviewItem[]>([]);
  const [previewRecipients, setPreviewRecipients] = useState<CampaignPreviewRecipient[]>([]);
  const [activePersonalizedPreview, setActivePersonalizedPreview] = useState("");
  const [loadingPersonalizedPreview, setLoadingPersonalizedPreview] = useState("");
  const [previewSignature, setPreviewSignature] = useState("");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const [timezoneOffset, setTimezoneOffset] = useState(defaultTimezoneOffset);
  const [sendAnytime, setSendAnytime] = useState(onboarding);
  const [pending, startTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();

  const usesContactAudience = !onboarding || recipientScope !== "control";
  const effectiveSegments = usesContactAudience ? chosenSegments : [];
  const multiSegment = effectiveSegments.length > 1;
  const canNext1 = Boolean(name.trim());
  const currentSegmentTexts =
    multiSegment && activeSegment
      ? { ...segmentTexts, [activeSegment]: { subject, body } }
      : segmentTexts;
  const segmentsReady = multiSegment
    ? effectiveSegments.every((segment) => {
        const text = currentSegmentTexts[segment];
        return Boolean(text?.subject.trim() && text.body.trim());
      })
    : Boolean(subject.trim() && body.trim());
  const currentPreviewSignature = useMemo(() => JSON.stringify({
    name: name.trim(),
    chosenSegments: effectiveSegments,
    recipientScope,
    subject,
    body,
    segmentTexts: currentSegmentTexts,
  }), [name, effectiveSegments, recipientScope, subject, body, currentSegmentTexts]);

  useEffect(() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    setScheduledAt(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`);
    setTimezoneOffset(now.getTimezoneOffset());
  }, []);

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
        segment: multiSegment ? activeSegment : (effectiveSegments[0] ?? null),
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
    if (effectiveSegments.length > 1 && !activeSegment) {
      const first = effectiveSegments[0];
      setActiveSegment(first);
      setSubject(segmentTexts[first]?.subject ?? "");
      setBody(segmentTexts[first]?.body ?? "");
    }
    setStep(2);
  }

  function continueToLaunch() {
    if (!segmentsReady) return;
    const nextSegmentTexts = multiSegment && activeSegment
      ? { ...segmentTexts, [activeSegment]: { subject, body } }
      : segmentTexts;
    if (multiSegment && activeSegment) setSegmentTexts(nextSegmentTexts);
    const signature = JSON.stringify({
      name: name.trim(),
      chosenSegments: effectiveSegments,
      recipientScope,
      subject,
      body,
      segmentTexts: nextSegmentTexts,
    });
    if (signature === previewSignature && personalizedPreviews.length) {
      setStep(3);
      return;
    }
    startPreviewTransition(async () => {
      setNotice(null);
      const result = await previewPersonalizedEmails({
        name,
        subject,
        body,
        segments: effectiveSegments,
        segmentTexts: nextSegmentTexts,
        recipientScope,
        onboarding,
      });
      if (result.error || !result.items.length) {
        setNotice(result.error ?? "Не удалось подготовить персональные примеры");
        return;
      }
      setPersonalizedPreviews(result.items);
      setPreviewRecipients(result.recipients);
      setActivePersonalizedPreview(`${result.items[0].segment ?? ""}:${result.items[0].contactId}`);
      setPreviewSignature(signature);
      setStep(3);
    });
  }

  function selectPersonalizedPreview(recipient: CampaignPreviewRecipient) {
    const key = `${recipient.segment ?? ""}:${recipient.contactId}`;
    setActivePersonalizedPreview(key);
    if (personalizedPreviews.some((item) => `${item.segment ?? ""}:${item.contactId}` === key)) return;
    setLoadingPersonalizedPreview(key);
    startPreviewTransition(async () => {
      const result = await previewPersonalizedEmailForRecipient({
        name,
        subject,
        body,
        segments: effectiveSegments,
        segmentTexts: currentSegmentTexts,
        recipientScope,
        onboarding,
        contactId: recipient.contactId,
        segment: recipient.segment,
      });
      setLoadingPersonalizedPreview("");
      if (!result.item) {
        setNotice(result.error ?? "Не удалось подготовить письмо");
        return;
      }
      setPersonalizedPreviews((current) => current.some((item) => `${item.segment ?? ""}:${item.contactId}` === key)
        ? current
        : [...current.slice(0, PERSONALIZED_PREVIEW_PERSISTED_MAX - 1), result.item!]);
    });
  }

  function updatePersonalizedPreview(key: string, patch: { subject: string; body: string }) {
    setPersonalizedPreviews((current) => current.map((item) =>
      `${item.segment ?? ""}:${item.contactId}` === key ? { ...item, ...patch } : item
    ));
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
      {onboarding && <input type="hidden" name="onboarding" value="1" />}
      {onboarding && <input type="hidden" name="recipientScope" value={recipientScope} />}
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
      <input type="hidden" name="personalizedPreviews" value={previewSignature === currentPreviewSignature ? JSON.stringify(personalizedPreviews) : ""} />
      <input type="hidden" name="timezoneOffset" value={timezoneOffset} />
      {usesContactAudience && multiSegment && <input type="hidden" name="segmentTexts" value={JSON.stringify(currentSegmentTexts)} />}

      <div hidden={step !== 1} className="mt-6 max-w-xl space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Название кампании</span>
          <input name="name" value={name} onChange={(event) => setName(event.target.value)} required className="input mt-2" placeholder="Холодная база — юристы" />
        </label>

        <div>
          <span className="text-sm font-medium text-slate-900">Кому отправляем</span>
          {onboarding && controlAddress && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {([
                { value: "contacts", label: "Контрагентам", detail: "Только выбранным сегментам" },
                { value: "control", label: "Только себе", detail: controlAddress.email },
                { value: "all", label: "Все вместе", detail: "Контрагентам и на личный адрес" },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={recipientScope === option.value}
                  onClick={() => setRecipientScope(option.value)}
                  className={`rounded-xl border p-3 text-left transition ${recipientScope === option.value ? "border-mint-400 bg-mint-50" : "border-line bg-white hover:border-slate-300"}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${recipientScope === option.value ? "border-mint-600" : "border-slate-300"}`}>
                      {recipientScope === option.value && <span className="h-2 w-2 rounded-full bg-mint-600" />}
                    </span>
                    {option.label}
                  </span>
                  <span className="mt-1 block truncate pl-6 text-[11px] text-ink-500">{option.detail}</span>
                </button>
              ))}
            </div>
          )}
          {usesContactAudience && (segments.length === 0 ? (
              <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-ink-500">Сегментов пока нет — письмо уйдёт по всей активной базе.</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-ink-500">Можно выбрать несколько: для каждого сегмента создастся отдельная кампания.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {segments.map((segment) => {
                    const selected = chosenSegments.includes(segment);
                    const item = segmentPreviews.find((candidate) => candidate.segment === segment);
                    return (
                      <span key={segment} className={`inline-flex overflow-hidden rounded-lg border ${selected ? "border-mint-400 bg-mint-100/40 text-mint-700" : "border-line bg-white text-ink-700"}`}>
                        <button type="button" onClick={() => selectSegments(segment)} className={`px-3 py-1.5 text-sm ${selected ? "font-semibold" : ""}`}>
                          {selected ? "✓ " : ""}{segment}
                        </button>
                        <button type="button" onClick={() => item && setPreview(item)} disabled={!item} aria-label={`Посмотреть состав сегмента ${segment}`} className="border-l border-current/10 px-2.5 text-xs font-semibold opacity-70 transition hover:bg-white/60 hover:opacity-100 disabled:opacity-30">i</button>
                      </span>
                    );
                  })}
                </div>
                {chosenSegments.map((segment) => <input key={segment} type="hidden" name="segments" value={segment} />)}
              </>
            ))}
        </div>

        <button type="button" disabled={!canNext1} onClick={continueToLetter} className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">Дальше: письмо →</button>
      </div>

      <div hidden={step !== 2} className="mt-6 max-w-2xl space-y-4">
        {!onboardingDone && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Заполните данные о бизнесе в настройках — ИИ сможет точнее подготовить письмо.</p>}

        {multiSegment && (
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="text-sm font-semibold text-slate-900">Отдельный текст для каждого сегмента</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {effectiveSegments.map((segment) => {
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

        <div className="flex gap-3"><button type="button" onClick={() => setStep(1)} className="rounded-lg border border-line px-5 py-3 text-sm font-semibold text-ink-700">← Назад</button><button type="button" disabled={!segmentsReady || previewPending} onClick={continueToLaunch} className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">{previewPending ? "Персонализируем…" : "Дальше: предпросмотр →"}</button></div>
      </div>

      <div hidden={step !== 3} className="mt-6 max-w-4xl space-y-4">
        <input type="hidden" name="followupSteps" value={JSON.stringify(followupSteps)} />
        <PersonalizedEmailPreview
          recipients={previewRecipients}
          items={personalizedPreviews}
          activeKey={activePersonalizedPreview}
          loadingKey={loadingPersonalizedPreview}
          onSelect={selectPersonalizedPreview}
          onChange={updatePersonalizedPreview}
        />

        <section className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Начало отправки</h3>
              <p className="mt-1 text-xs leading-5 text-ink-500">Кампания встанет в очередь в выбранный момент.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-900">
              <input type="checkbox" name="sendAnytime" checked={sendAnytime} onChange={(event) => setSendAnytime(event.target.checked)} className="size-4 accent-emerald-600" />
              Отправлять в любое время
            </label>
          </div>
          <label className="mt-4 block max-w-sm">
            <span className="text-sm font-medium text-slate-900">Дата и время</span>
            <input name="scheduledAt" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required className="input metric-number mt-2" />
            <span className="mt-1.5 block text-xs leading-5 text-ink-500">{sendAnytime ? "После этого времени письма смогут отправляться без ограничения по рабочим часам." : "После этого времени — только в разрешённые рабочие часы."}</span>
          </label>
        </section>
        <div className="rounded-xl border border-line bg-white p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900"><input type="checkbox" name="followupEnabled" checked={followupEnabled} onChange={(event) => setFollowupEnabled(event.target.checked)} />Follow-up: написать, если нет ответа</label>
          {followupEnabled && <div className="mt-3 space-y-3">
            {followupSteps.map((item, index) => <div key={index} className="rounded-lg border border-line bg-surface p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-900">Письмо {index + 2}</span><button type="button" onClick={() => setFollowupSteps((steps) => steps.filter((_, i) => i !== index))} className="text-xs text-ink-500">Убрать</button></div><label className="mt-2 flex items-center gap-2 text-xs text-ink-700">через <input type="number" min={1} max={30} value={item.daysAfterPrevious} onChange={(event) => updateFollowup(index, { daysAfterPrevious: Number(event.target.value) || 1 })} className="input !w-16 !py-1" /> дней</label><input value={item.subject} onChange={(event) => updateFollowup(index, { subject: event.target.value })} className="input mt-2 !py-1.5 text-xs" placeholder="Тема" /><textarea value={item.body} onChange={(event) => updateFollowup(index, { body: event.target.value })} rows={3} className="input mt-2 text-xs" placeholder="Текст письма" /></div>)}
            {followupSteps.length < MAX_FOLLOWUP_STEPS && <button type="button" onClick={addFollowup} className="text-xs font-semibold text-indigo-600">+ добавить письмо</button>}
          </div>}
        </div>

        <div className="rounded-xl border border-line bg-white p-4"><label className="flex items-center gap-2 text-sm font-medium text-slate-900"><input type="checkbox" name="trackingEnabled" />Отслеживать открытия (Open Rate)</label><p className="mt-2 text-xs text-ink-500">К текстовому письму добавится минимальная HTML-версия только с пикселем открытия. Ссылки не подменяются и клики не отслеживаются.</p></div>

        <div className="flex flex-wrap gap-3"><button type="button" onClick={() => setStep(2)} className="rounded-lg border border-line px-5 py-3 text-sm font-semibold text-ink-700">← Назад</button><button className="rounded-lg brand-gradient px-8 py-3 text-sm font-semibold text-white">Создать и запустить кампанию</button></div>
      </div>
      {preview && <SegmentPreviewDialog preview={preview} onboarding={onboarding} onClose={() => setPreview(null)} />}
    </form>
  );
}

function PersonalizedEmailPreview({
  recipients,
  items,
  activeKey,
  loadingKey,
  onSelect,
  onChange,
}: {
  recipients: CampaignPreviewRecipient[];
  items: CampaignPersonalizedPreviewItem[];
  activeKey: string;
  loadingKey: string;
  onSelect: (recipient: CampaignPreviewRecipient) => void;
  onChange: (key: string, patch: { subject: string; body: string }) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const activeRecipient = recipients.find((item) => `${item.segment ?? ""}:${item.contactId}` === activeKey) ?? recipients[0];
  const active = items.find((item) => `${item.segment ?? ""}:${item.contactId}` === activeKey);
  const [draftSubject, setDraftSubject] = useState(active?.subject ?? "");
  const [draftBody, setDraftBody] = useState(active?.body ?? "");
  const visibleRecipients = showAll ? recipients : recipients.slice(0, 5);
  const activeIsLoading = loadingKey === activeKey;

  useEffect(() => {
    setDraftSubject(active?.subject ?? "");
    setDraftBody(active?.body ?? "");
    setEditing(false);
  }, [activeKey, active?.subject, active?.body]);

  if (!activeRecipient) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <header className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Так письмо увидит получатель</h3>
            <p className="mt-1 text-xs leading-5 text-ink-500">Показываем несколько готовых персональных версий. Эти тексты сохранятся в кампании.</p>
          </div>
          <span className="metric-number rounded-full bg-mint-50 px-3 py-1 text-xs font-semibold text-mint-800">{recipients.length} получателей</span>
        </div>
      </header>
      <div className="grid min-h-[24rem] md:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="border-b border-line bg-[#fafbf9] md:border-b-0 md:border-r">
          <div className={showAll ? "max-h-[32rem] overflow-y-auto overscroll-contain" : ""}>
          {visibleRecipients.map((item) => {
            const key = `${item.segment ?? ""}:${item.contactId}`;
            const selected = key === activeKey;
            return (
              <button key={key} type="button" onClick={() => onSelect(item)} aria-pressed={selected} className={`block w-full border-b border-line px-4 py-3 text-left outline-none transition [contain-intrinsic-size:0_68px] [content-visibility:auto] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mint-300 ${selected ? "bg-mint-50" : "hover:bg-white"}`}>
                <span className="block truncate text-sm font-semibold text-slate-900">{item.name || item.email}</span>
                <span className="mt-0.5 block truncate text-xs text-ink-500">{item.email}</span>
                {item.company && <span className="mt-1 block truncate text-xs text-ink-700">{item.company}</span>}
              </button>
            );
          })}
          </div>
          {recipients.length > 5 && (
            <button type="button" onClick={() => setShowAll((current) => !current)} className="flex w-full items-center justify-center gap-1.5 border-t border-line bg-white px-4 py-3 text-xs font-semibold text-mint-700 outline-none transition hover:bg-mint-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mint-300">
              {showAll ? "Показать первые 5" : "Посмотреть еще"}
              <ChevronIcon open={showAll} />
            </button>
          )}
        </div>
        <article className="min-w-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
            <div className="min-w-0">
              <p className="text-xs text-ink-500">Кому</p>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-semibold text-slate-900">{activeRecipient.name || activeRecipient.email} &lt;{activeRecipient.email}&gt;</p>
                <Link href={`/app/contacts?contact=${encodeURIComponent(activeRecipient.contactId)}`} target="_blank" rel="noreferrer" aria-label={`Открыть карточку контакта ${activeRecipient.name || activeRecipient.email}`} className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink-500 outline-none transition hover:border-mint-300 hover:text-mint-700 focus-visible:ring-2 focus-visible:ring-mint-300">
                  <InfoIcon />
                </Link>
              </div>
              {(activeRecipient.company || activeRecipient.segment) && <p className="mt-1 truncate text-xs text-ink-500">{[activeRecipient.company, activeRecipient.segment].filter(Boolean).join(" · ")}</p>}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {active?.personalizationMode === "generic" && <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">Без персонализации</span>}
              {active && !editing && <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-ink-700 outline-none transition hover:border-slate-300 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-mint-300">Редактировать письмо</button>}
            </div>
          </div>
          {activeIsLoading && <div role="status" className="flex min-h-56 items-center justify-center text-sm text-ink-500">Готовим персональное письмо…</div>}
          {!activeIsLoading && !active && <div className="flex min-h-56 items-center justify-center text-sm text-ink-500">Выберите получателя, чтобы подготовить письмо.</div>}
          {!activeIsLoading && active && !editing && <>
            {active.personalizationMode === "generic" && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-900">Недостаточно данных для персонализации — отправим письмо без неё.</p>}
            <h4 className="mt-5 text-base font-semibold text-slate-900">{active.subject}</h4>
            <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-ink-700">{active.body}</div>
          </>}
          {!activeIsLoading && active && editing && <div className="mt-5 space-y-4">
            <label className="block"><span className="text-xs font-medium text-ink-500">Тема</span><input value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} className="input mt-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-ink-500">Текст</span><textarea value={draftBody} onChange={(event) => setDraftBody(event.target.value)} rows={12} className="input mt-1.5 text-sm leading-6" /></label>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => { setDraftSubject(active.subject); setDraftBody(active.body); setEditing(false); }} className="rounded-lg border border-line px-4 py-2 text-xs font-semibold text-ink-600">Отмена</button>
              <button type="button" disabled={!draftSubject.trim() || !draftBody.trim()} onClick={() => { onChange(activeKey, { subject: draftSubject.trim(), body: draftBody.trim() }); setEditing(false); }} className="btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50">Сохранить письмо</button>
            </div>
          </div>}
        </article>
      </div>
    </section>
  );
}

function InfoIcon() { return <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round"><circle cx="10" cy="10" r="7" /><path d="M10 9v4M10 6.5h.01" /></svg>; }
function ChevronIcon({ open }: { open: boolean }) { return <svg aria-hidden="true" viewBox="0 0 16 16" className={`size-3.5 fill-none stroke-current transition-transform ${open ? "rotate-180" : ""}`} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m4 6 4 4 4-4" /></svg>; }

function SegmentPreviewDialog({ preview, onboarding, onClose }: { preview: CampaignSegmentPreview; onboarding: boolean; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  const href = onboarding
    ? `/app/setup?s=3&segment=${encodeURIComponent(preview.segment)}`
    : `/app/contacts?segment=${encodeURIComponent(preview.segment)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-labelledby="segment-preview-title">
      <button type="button" className="absolute inset-0" aria-label="Закрыть просмотр сегмента" onClick={onClose} />
      <section className="relative max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <p className="text-xs font-medium text-ink-500">Состав сегмента</p>
            <h2 id="segment-preview-title" className="mt-1 text-xl font-semibold text-slate-900">{preview.segment}</h2>
            <p className="metric-number mt-1 text-xs text-ink-500">{preview.count} активных контактов</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-lg text-ink-500 transition hover:bg-surface hover:text-slate-900" aria-label="Закрыть">×</button>
        </header>
        <div className="max-h-[50vh] overflow-y-auto overscroll-contain">
          {preview.contacts.map((contact) => (
            <div key={contact.id} className="grid gap-1 border-b border-line px-5 py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-4">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{contact.name || contact.email}</p><p className="truncate text-xs text-ink-500">{contact.email}</p></div>
              <div className="min-w-0 sm:text-right"><p className="truncate text-sm text-ink-700">{contact.company || "Компания не указана"}</p>{contact.role && <p className="truncate text-xs text-ink-500">{contact.role}</p>}</div>
            </div>
          ))}
          {preview.contacts.length === 0 && <p className="px-5 py-10 text-center text-sm text-ink-500">В сегменте пока нет активных контактов.</p>}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-line bg-[#fafbf9] px-5 py-4">
          {preview.count > preview.contacts.length ? <p className="text-xs text-ink-500">Показаны первые {preview.contacts.length}</p> : <span />}
          <Link href={href} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">Смотреть в базе</Link>
        </footer>
      </section>
    </div>
  );
}
