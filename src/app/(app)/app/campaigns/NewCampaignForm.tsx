"use client";

import { useState, useTransition } from "react";
import { createCampaign, generateVariants } from "./actions";

type Variant = { subject: string; body: string };

export function NewCampaignForm({
  segments,
  senders,
  onboardingDone,
}: {
  segments: string[];
  senders: { id: string; label: string }[];
  onboardingDone: boolean;
}) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function handleGenerate() {
    startTransition(async () => {
      const v = await generateVariants();
      setVariants(v);
      if (v[0]) {
        setSubject(v[0].subject);
        setBody(v[0].body);
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
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
          <span className="text-sm font-medium text-slate-900">Текст письма</span>
          <span className="mt-0.5 block text-xs text-ink-500">
            Доступны переменные: {"{{name}}"}, {"{{company}}"}
          </span>
          <textarea
            name="body"
            rows={12}
            className="input mt-2 font-mono text-xs"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </label>

        <button className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white">
          Создать кампанию
        </button>
      </form>

      <aside className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full brand-gradient text-[10px] font-bold text-white">
            AI
          </span>
          <h3 className="font-semibold text-slate-900">Генерация писем</h3>
        </div>
        <p className="mt-2 text-sm text-ink-500">
          AI напишет варианты письма под ваш оффер и аудиторию.
        </p>
        {!onboardingDone && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Заполните «Мой бизнес» — тогда письма будут точнее.
          </p>
        )}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={pending}
          className="mt-4 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 disabled:opacity-60"
        >
          {pending ? "Генерируем…" : "Сгенерировать варианты"}
        </button>

        <div className="mt-4 space-y-3">
          {variants.map((v, i) => (
            <button
              type="button"
              key={i}
              onClick={() => {
                setSubject(v.subject);
                setBody(v.body);
              }}
              className="block w-full rounded-lg border border-line bg-white p-3 text-left text-xs transition hover:border-mint-400"
            >
              <div className="font-semibold text-slate-900">
                Вариант {i + 1}: {v.subject}
              </div>
              <div className="mt-1 line-clamp-3 text-ink-500">{v.body}</div>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
