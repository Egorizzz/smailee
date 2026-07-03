"use client";

import { useState } from "react";

export function LeadForm() {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError(null);
    const form = e.currentTarget;
    const data = {
      name: (form.elements.namedItem("name") as HTMLInputElement).value,
      email: (form.elements.namedItem("email") as HTMLInputElement).value,
      messenger: (form.elements.namedItem("messenger") as HTMLInputElement)
        .value,
    };

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Не удалось отправить заявку");
      }
      setStatus("ok");
      form.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  if (status === "ok") {
    return (
      <div className="rounded-2xl border border-mint-200 bg-mint-50 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-mint-500 text-2xl text-white">
          ✓
        </div>
        <h3 className="text-lg font-semibold text-slate-900">
          Заявка принята!
        </h3>
        <p className="mt-2 text-sm text-ink-700">
          Свяжемся с вами и настроим первую тестовую кампанию вместе. Обычно
          отвечаем в течение дня.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        name="name"
        required
        placeholder="Как вас зовут"
        className="w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />
      <input
        name="email"
        type="email"
        required
        placeholder="Email для связи"
        className="w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />
      <input
        name="messenger"
        placeholder="Telegram (по желанию)"
        className="w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />
      {status === "error" && (
        <p className="text-sm text-red-500">{error}</p>
      )}
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-lg brand-gradient px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
      >
        {status === "loading" ? "Отправляем…" : "Получить тестовую кампанию"}
      </button>
      <p className="text-center text-xs text-ink-500">
        Первую кампанию настроим вместе. Онбординг вручную — доведём до первых лидов.
      </p>
    </form>
  );
}
