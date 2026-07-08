"use client";

import { useState } from "react";
import { addManagedSender, addOwnSender } from "./actions";

// Клиентский slug/localpart-хелпер для превью адреса (серверный toDnsLabel —
// источник истины; здесь только грубая имитация для мгновенного предпросмотра).
function previewLabel(input: string, fallback: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

export function SenderForm({
  baseDomain,
  canUseOwnDomain,
  defaultSlug,
}: {
  baseDomain: string;
  canUseOwnDomain: boolean;
  defaultSlug: string;
}) {
  const [mode, setMode] = useState<"managed" | "own">("managed");
  const [localPart, setLocalPart] = useState("hello");

  // Поддомен генерируется на сервере из названия компании (защита от бренд-сквоттинга,
  // напр. sberbank.smailee.ru), здесь показываем предпросмотр по этому же значению.
  const previewAddress = `${previewLabel(localPart, "hello")}@${defaultSlug}.${baseDomain}`;

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      {/* переключатель режима */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("managed")}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
            mode === "managed"
              ? "border-mint-400 bg-mint-50 text-mint-700"
              : "border-line text-ink-700 hover:border-ink-500"
          }`}
        >
          Поддомен Smailee · без настройки
        </button>
        <button
          type="button"
          onClick={() => setMode("own")}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
            mode === "own"
              ? "border-indigo-400 bg-indigo-50 text-indigo-700"
              : "border-line text-ink-700 hover:border-ink-500"
          }`}
        >
          Свой домен {canUseOwnDomain ? "" : "· Про"}
        </button>
      </div>

      {mode === "managed" ? (
        <form action={addManagedSender} className="mt-5 space-y-4">
          <p className="rounded-lg bg-mint-50 px-3 py-2 text-sm text-mint-700">
            Мы выдадим вам поддомен на {baseDomain} и сами настроим все DNS-записи
            (SPF, DKIM, DMARC). Вам не нужно ничего прописывать — можно слать сразу.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-900">Имя отправителя</span>
              <input name="fromName" placeholder="Иван из Rogaikopyta" className="input mt-2" required />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-900">Адрес (до @)</span>
              <input
                name="localPart"
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value)}
                placeholder="hello"
                className="input mt-2"
              />
            </label>
          </div>
          <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            <span className="text-ink-500">Письма будут уходить с адреса:</span>{" "}
            <span className="font-mono font-medium text-slate-900">{previewAddress}</span>
          </div>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Демо-режим: письма уходят только на разрешённые тестовые адреса и на вашу
            почту — чтобы вы вживую увидели, как это работает. Рассылка по своей базе —
            после подключения своего домена на тарифе «Про».
          </p>
          <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
            Создать отправителя
          </button>
        </form>
      ) : (
        <div className="mt-5">
          {!canUseOwnDomain ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Отправка со своего домена доступна на тарифе <b>«Про»</b>. На текущем
              тарифе используйте поддомен Smailee (слева) — доставляемость такая же,
              а настраивать DNS не нужно. Оформить «Про» можно в разделе{" "}
              <a href="/app/billing" className="underline">Тариф</a>.
            </div>
          ) : (
            <form action={addOwnSender} className="space-y-4">
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                Рекомендуем завести <b>поддомен</b> для рассылок (например{" "}
                <span className="font-mono">mail.вашдомен.ру</span>), а не основной
                домен — так репутация вашей рабочей почты не пострадает. После
                добавления мы покажем DNS-записи, которые нужно прописать.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-900">Имя отправителя</span>
                  <input name="fromName" placeholder="Иван из Rogaikopyta" className="input mt-2" required />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-900">Email на вашем домене</span>
                  <input name="fromEmail" type="email" placeholder="hello@mail.rogaikopyta.ru" className="input mt-2" required />
                </label>
              </div>
              <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
                Добавить свой домен
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
