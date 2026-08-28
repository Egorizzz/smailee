"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { OPEN_DEMO_EVENT } from "@/components/DemoTrigger";
import { demoCopy } from "@/content/landing/demo";

type SubmitStatus = "idle" | "loading" | "ok" | "error";

function DemoForm({ onClose, source }: { onClose: () => void; source: string }) {
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus({ preventScroll: true });
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setError(null);

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          company: formData.get("company"),
          contact: formData.get("contact"),
          source,
          privacyConsent: formData.get("privacyConsent") === "on",
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || demoCopy.form.error);
      }
      setStatus("ok");
      form.reset();
    } catch (submitError) {
      setStatus("error");
      setError(submitError instanceof Error ? submitError.message : demoCopy.form.error);
    }
  }

  if (status === "ok") {
    return (
      <div className="px-6 py-12 text-center sm:px-10">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#c8ff45] text-xl font-bold text-[#0b3b31]">✓</div>
        <h3 className="mt-5 font-display text-2xl font-semibold text-[#10231d]">{demoCopy.form.successTitle}</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#68736e]">{demoCopy.form.successText}</p>
        <button type="button" onClick={onClose} className="btn-primary mt-6 px-5 py-2.5 text-sm font-semibold">{demoCopy.form.done}</button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="p-6 sm:p-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h3 className="font-display text-2xl font-semibold text-[#10231d] sm:text-3xl">{demoCopy.form.title}</h3>
        </div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-xl text-[#68736e] transition hover:bg-black/[0.04]" aria-label={demoCopy.form.closeAria}>×</button>
      </div>
      <div className="mt-7 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#47524d]">{demoCopy.form.fields[0].label}</span>
          <input ref={nameInputRef} name="name" required autoComplete="name" className="w-full rounded-xl border border-black/10 bg-[#f7f8f5] px-4 py-3 text-sm text-[#10231d] outline-none transition focus:border-[#0a6a4c] focus:ring-2 focus:ring-[#c8ff45]/50" placeholder={demoCopy.form.fields[0].placeholder} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#47524d]">{demoCopy.form.fields[1].label}</span>
          <input name="company" required autoComplete="organization" className="w-full rounded-xl border border-black/10 bg-[#f7f8f5] px-4 py-3 text-sm text-[#10231d] outline-none transition focus:border-[#0a6a4c] focus:ring-2 focus:ring-[#c8ff45]/50" placeholder={demoCopy.form.fields[1].placeholder} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#47524d]">{demoCopy.form.fields[2].label}</span>
          <input name="contact" required autoComplete="email" className="w-full rounded-xl border border-black/10 bg-[#f7f8f5] px-4 py-3 text-sm text-[#10231d] outline-none transition focus:border-[#0a6a4c] focus:ring-2 focus:ring-[#c8ff45]/50" placeholder={demoCopy.form.fields[2].placeholder} />
        </label>
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-[#f7f8f5] px-3.5 py-3 text-left">
        <input
          name="privacyConsent"
          type="checkbox"
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#0a6a4c]"
        />
        <span className="text-[11px] leading-5 text-[#68736e]">
          Я согласен(на) на обработку данных для связи по заявке на условиях{" "}
          <Link href="/personal-data-consent" target="_blank" className="font-medium text-[#0a6a4c] underline underline-offset-2">
            отдельного согласия
          </Link>
          .
        </span>
      </label>
      {status === "error" && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
      <button type="submit" disabled={status === "loading"} className="btn-primary mt-5 w-full px-5 py-3.5 text-sm font-semibold disabled:cursor-wait disabled:opacity-60">
        {status === "loading" ? demoCopy.form.loading : demoCopy.form.submit}
      </button>
      <p className="mt-3 text-center text-[11px] text-[#7d8782]">{demoCopy.form.note}</p>
    </form>
  );
}

export function DemoCtaInteractive() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [demoSource, setDemoSource] = useState("demo-section");

  useEffect(() => {
    const openDemo = (event: Event) => {
      const source = (event as CustomEvent<{ source?: string }>).detail?.source;
      setDemoSource(source || "landing-demo-cta");
      setIsFormOpen(true);
    };
    window.addEventListener(OPEN_DEMO_EVENT, openDemo);
    return () => window.removeEventListener(OPEN_DEMO_EVENT, openDemo);
  }, []);

  useEffect(() => {
    if (!isFormOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFormOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isFormOpen]);

  return (
    <>
      <button type="button" onClick={() => { setDemoSource("demo-section"); setIsFormOpen(true); }} className="btn-white group mt-4 inline-flex min-h-16 w-full items-center justify-center gap-4 px-10 text-base font-semibold shadow-[0_18px_46px_rgba(0,0,0,0.24)] sm:w-auto sm:min-w-[360px]">
        {demoCopy.button} <span className="text-xl transition-transform group-hover:translate-x-1">→</span>
      </button>

      {isFormOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#061713]/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsFormOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label={demoCopy.dialogAria} className="w-full max-w-lg overflow-hidden rounded-[24px] bg-white shadow-[0_35px_100px_rgba(0,0,0,0.45)]">
            <DemoForm onClose={() => setIsFormOpen(false)} source={demoSource} />
          </div>
        </div>
      )}
    </>
  );
}
