"use client";

import { useState } from "react";
import Link from "next/link";
import { leadFormCopy } from "@/content/landing/lead-form";

const landingCopy = { leadForm: leadFormCopy };

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
      company: (form.elements.namedItem("company") as HTMLInputElement).value,
      messenger: (form.elements.namedItem("messenger") as HTMLInputElement)
        .value,
      privacyConsent: (form.elements.namedItem("privacyConsent") as HTMLInputElement).checked,
    };

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || landingCopy.leadForm.error);
      }
      setStatus("ok");
      form.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : landingCopy.leadForm.fallbackError);
    }
  }

  if (status === "ok") {
    return (
      <div className="rounded-xl border border-mint-200 bg-mint-50 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-mint-500 text-2xl text-white">
          ✓
        </div>
        <h3 className="font-display text-lg font-semibold text-[color:var(--foreground)]">
          {landingCopy.leadForm.successTitle}
        </h3>
        <p className="mt-2 text-sm text-ink-700">
          {landingCopy.leadForm.successText}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        name="name"
        required
        placeholder={landingCopy.leadForm.placeholders.name}
        className="w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none transition focus:border-mint-500 focus:ring-2 focus:ring-mint-100"
      />
      <input
        name="company"
        placeholder={landingCopy.leadForm.placeholders.company}
        className="w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none transition focus:border-mint-500 focus:ring-2 focus:ring-mint-100"
      />
      <input
        name="email"
        type="email"
        required
        placeholder={landingCopy.leadForm.placeholders.email}
        className="w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none transition focus:border-mint-500 focus:ring-2 focus:ring-mint-100"
      />
      <input
        name="messenger"
        placeholder={landingCopy.leadForm.placeholders.messenger}
        className="w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none transition focus:border-mint-500 focus:ring-2 focus:ring-mint-100"
      />
      {status === "error" && (
        <p className="text-sm text-red-500">{error}</p>
      )}
      <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-surface px-3 py-3 text-left">
        <input name="privacyConsent" type="checkbox" required className="mt-0.5 h-4 w-4 shrink-0 accent-[#0a6a4c]" />
        <span className="text-xs leading-5 text-ink-500">
          Я согласен(на) на обработку данных для связи по заявке на условиях {" "}
          <Link href="/personal-data-consent" target="_blank" className="font-medium text-[#0a6a4c] underline underline-offset-2">
            отдельного согласия
          </Link>
          .
        </span>
      </label>
      <button
        type="submit"
        disabled={status === "loading"}
        className="btn-primary w-full px-4 py-3.5 text-sm font-semibold disabled:opacity-60"
      >
        {status === "loading" ? landingCopy.leadForm.loading : landingCopy.leadForm.submit}
      </button>
      <p className="text-center text-xs text-ink-500">
        {landingCopy.leadForm.note}
      </p>
    </form>
  );
}
