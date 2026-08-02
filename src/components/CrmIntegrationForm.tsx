"use client";

/**
 * Подключение Битрикс24 и настройка передачи лидов.
 *
 * Вебхук — по сути пароль от CRM клиента, поэтому поле ведёт себя как пароль:
 * сохранённое значение наружу НЕ отдаётся (сервер присылает только флаг «уже
 * подключён»), а ввод по умолчанию скрыт с возможностью подсмотреть.
 */

import { useState, useTransition } from "react";
import { saveCrmSettings } from "@/app/(app)/app/settings/crmActions";
import { HANDOFF_TRIGGERS } from "@/lib/crm/handoffTriggers";

export function CrmIntegrationForm({
  connected,
  selectedTriggers,
  customHandoffPrompt,
}: {
  connected: boolean;
  selectedTriggers: string[];
  customHandoffPrompt: string;
}) {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [reveal, setReveal] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSave(formData: FormData) {
    startTransition(async () => {
      setMsg(null);
      const res = await saveCrmSettings(formData);
      setMsg(res.error ? { text: res.error, ok: false } : { text: res.ok ?? "Сохранено", ok: true });
    });
  }

  return (
    <form action={handleSave} className="mt-4 space-y-5">
      <label className="block">
        <span className="text-sm font-medium text-slate-900">Вебхук Битрикс24</span>
        <span className="mt-0.5 block text-xs text-ink-500">
          Битрикс24 → Разработчикам → Другое → Входящий вебхук. Нужны права{" "}
          <code>crm</code>. Ссылка вида{" "}
          <code>https://ваш-портал.bitrix24.ru/rest/1/токен/</code>
        </span>
        <div className="mt-2 flex gap-2">
          <input
            name="bitrixWebhook"
            type={reveal ? "text" : "password"}
            autoComplete="off"
            placeholder={connected ? "Подключён — введите новый, чтобы заменить" : "https://…/rest/1/токен/"}
            className="input flex-1"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="shrink-0 rounded-lg border border-line px-3 text-xs text-ink-500 hover:text-slate-900"
          >
            {reveal ? "Скрыть" : "Показать"}
          </button>
        </div>
        <span className="mt-1 block text-xs text-ink-500">
          {connected
            ? "Сейчас подключён. Пустое поле при сохранении отключит интеграцию."
            : "Проверим ссылку перед сохранением — нерабочую не примем."}
        </span>
      </label>

      <fieldset>
        <legend className="text-sm font-medium text-slate-900">
          Когда передавать лида в CRM
        </legend>
        <p className="mt-0.5 text-xs text-ink-500">
          Отмеченные действия клиента считаются сигналом «созрел». Как только
          одно из них происходит — лид уходит в Битрикс24, а ИИ перестаёт
          отвечать: дальше работает ваш продавец. Оставьте хотя бы один
          сценарий (галочку или свой ниже) — без этого ИИ не поймёт, когда
          остановиться, и будет вести переписку бесконечно.
        </p>
        <div className="mt-2 space-y-2">
          {HANDOFF_TRIGGERS.map((t) => (
            <label
              key={t.key}
              className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2"
            >
              <input
                type="checkbox"
                name="crmHandoffTriggers"
                value={t.key}
                defaultChecked={selectedTriggers.includes(t.key)}
                className="mt-0.5"
              />
              <span className="text-sm text-slate-900">{t.label}</span>
            </label>
          ))}
        </div>

        <label className="mt-3 block">
          <span className="text-sm text-slate-900">Свой сценарий (необязательно)</span>
          <textarea
            name="customHandoffPrompt"
            defaultValue={customHandoffPrompt}
            rows={2}
            placeholder="Например: клиент прислал техническое задание или реквизиты для договора"
            className="input mt-1 text-sm"
          />
          <span className="mt-0.5 block text-xs text-ink-500">
            Опишите своими словами, что для вас значит «готов» — ИИ будет
            искать это в переписке вдобавок к отмеченным сценариям.
          </span>
        </label>
      </fieldset>

      {msg && (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            msg.ok ? "bg-mint-100/60 text-mint-700" : "bg-red-50 text-red-600"
          }`}
        >
          {msg.text}
        </p>
      )}

      <button
        disabled={pending}
        className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Проверяем вебхук…" : "Сохранить"}
      </button>
    </form>
  );
}
