"use client";

import { useState, useTransition, useEffect } from "react";
import {
  createCampaign,
  generateVariants,
  loadPreset,
  sendTestEmail,
} from "./actions";

type Variant = { subject: string; body: string };

export function NewCampaignForm({
  segments,
  senders,
  onboardingDone,
  initialPreset,
}: {
  segments: string[];
  senders: { id: string; label: string }[];
  onboardingDone: boolean;
  initialPreset?: string | null;
}) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isHtml, setIsHtml] = useState(false);
  const [ab, setAb] = useState(false);
  const [followup, setFollowup] = useState(false);
  const [pending, startTransition] = useTransition();
  const [previewKey, setPreviewKey] = useState(0);

  // если пришёл ?preset= — загрузить HTML-пресет
  useEffect(() => {
    if (initialPreset) {
      loadPreset(initialPreset).then((p) => {
        if (p) {
          setSubject(p.subject);
          setBody(p.html);
          setIsHtml(true);
          setPreviewKey((k) => k + 1);
        }
      });
    }
  }, [initialPreset]);

  function handleGenerate() {
    startTransition(async () => {
      const v = await generateVariants();
      setVariants(v);
      if (v[0]) {
        setSubject(v[0].subject);
        setBody(v[0].body);
        setIsHtml(false);
        setPreviewKey((k) => k + 1);
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <form action={createCampaign} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Название кампании</span>
          <input name="name" className="input mt-2" placeholder="Холодная база — юристы" required />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-900">Сегмент</span>
            <select name="segment" className="input mt-2">
              <option value="">Все контакты</option>
              {segments.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-900">Отправитель</span>
            <select name="senderId" className="input mt-2">
              <option value="">— выбрать —</option>
              {senders.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isHtml"
            checked={isHtml}
            onChange={(e) => { setIsHtml(e.target.checked); setPreviewKey((k) => k + 1); }}
          />
          HTML-письмо (дизайнерский шаблон)
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-900">Тема письма</span>
          <input
            name="subject"
            className="input mt-2"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-900">
            {isHtml ? "HTML-код письма" : "Текст письма"}
          </span>
          <span className="mt-0.5 block text-xs text-ink-500">
            Переменные: {"{{name}}"}, {"{{company}}"}, {"{{cta_url}}"}
          </span>
          <textarea
            name="body"
            rows={isHtml ? 14 : 10}
            className="input mt-2 font-mono text-xs"
            value={body}
            onChange={(e) => { setBody(e.target.value); setPreviewKey((k) => k + 1); }}
            required
          />
        </label>

        {/* A/B */}
        <div className="rounded-xl border border-line p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" name="abEnabled" checked={ab} onChange={(e) => setAb(e.target.checked)} />
            A/B-тест: второй вариант письма
          </label>
          {ab && (
            <div className="mt-3 space-y-3">
              <input name="subjectB" className="input" placeholder="Тема (вариант B)" />
              <textarea name="bodyB" rows={6} className="input font-mono text-xs" placeholder="Текст варианта B" />
            </div>
          )}
        </div>

        {/* follow-up */}
        <div className="rounded-xl border border-line p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" name="followupEnabled" checked={followup} onChange={(e) => setFollowup(e.target.checked)} />
            Follow-up: дослать письмо, если нет ответа
          </label>
          {followup && (
            <div className="mt-3 space-y-3">
              <label className="block text-sm text-ink-700">
                Через сколько дней:
                <input name="followupDays" type="number" defaultValue={3} min={1} max={30} className="input mt-1 w-24" />
              </label>
              <input name="followupSubject" className="input" placeholder="Тема follow-up (по умолчанию Re: ...)" />
              <textarea name="followupBody" rows={4} className="input font-mono text-xs" placeholder="Текст follow-up письма" />
            </div>
          )}
        </div>

        {/* расписание */}
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Отложенный запуск (необязательно)</span>
          <input name="scheduledAt" type="datetime-local" className="input mt-2" />
        </label>

        <button className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-90">
          Создать кампанию
        </button>
      </form>

      <aside className="space-y-4">
        {/* AI генерация */}
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full brand-gradient text-[10px] font-bold text-white">AI</span>
            <h3 className="font-semibold text-slate-900">Генерация текста</h3>
          </div>
          {!onboardingDone && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Заполните «Мой бизнес» — тогда письма будут точнее.
            </p>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={pending}
            className="mt-3 w-full rounded-lg brand-gradient px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Генерируем…" : "Сгенерировать варианты"}
          </button>
          <div className="mt-3 space-y-2">
            {variants.map((v, i) => (
              <button
                type="button"
                key={i}
                onClick={() => { setSubject(v.subject); setBody(v.body); setIsHtml(false); setPreviewKey((k) => k + 1); }}
                className="block w-full rounded-lg border border-line bg-white p-3 text-left text-xs transition hover:border-mint-400"
              >
                <div className="font-semibold text-slate-900">Вариант {i + 1}: {v.subject}</div>
                <div className="mt-1 line-clamp-2 text-ink-500">{v.body}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Предпросмотр HTML */}
        {isHtml && (
          <div className="rounded-xl border border-line bg-white p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Предпросмотр</div>
            <iframe
              key={previewKey}
              srcDoc={body
                .replace(/\{\{\s*name\s*\}\}/g, "Пётр")
                .replace(/\{\{\s*company\s*\}\}/g, "ООО «Ромашка»")
                .replace(/\{\{\s*\w+\s*\}\}/g, "#")}
              title="preview"
              className="h-72 w-full rounded-lg border border-line"
            />
          </div>
        )}

        {/* Тестовое письмо */}
        <form action={sendTestEmail} className="rounded-xl border border-line bg-white p-5">
          <h3 className="font-semibold text-slate-900">Тестовое письмо</h3>
          <p className="mt-1 text-xs text-ink-500">Отправьте себе перед запуском.</p>
          <input type="hidden" name="subject" value={subject} />
          <input type="hidden" name="body" value={body} />
          {isHtml && <input type="hidden" name="isHtml" value="on" />}
          <input name="testEmail" type="email" className="input mt-3" placeholder="ваш@email.ru" />
          <button className="mt-3 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700">
            Отправить тест
          </button>
        </form>
      </aside>
    </div>
  );
}
