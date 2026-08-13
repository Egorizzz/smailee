"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { OPEN_DEMO_EVENT } from "@/components/DemoTrigger";
import { commonCopy } from "@/content/landing/common";
import { demoCopy } from "@/content/landing/demo";

const landingCopy = { common: commonCopy, demo: demoCopy };

type SubmitStatus = "idle" | "loading" | "ok" | "error";

const sentMessages = landingCopy.demo.sentMessages;
const clientReplies = landingCopy.demo.clientReplies;

function OutboxScreen() {
  return (
    <div className="grid h-[120px] grid-cols-[54px_1fr] overflow-hidden bg-[#f7f8f5] sm:h-[240px] sm:grid-cols-[96px_1fr]">
      <aside className="border-r border-black/10 bg-[#0b3b31] px-2.5 py-4 text-white sm:px-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#c8ff45] text-xs font-black text-[#0b3b31]">{landingCopy.common.logoInitial}</div>
        <nav className="mt-6 space-y-1.5 text-[9px] text-white/50 sm:text-[10px]">
          <div className="rounded-lg bg-white/10 px-2 py-2 text-white">{landingCopy.demo.nav[0]}</div>
          <div className="px-2 py-2">{landingCopy.demo.nav[1]}</div>
          <div className="px-2 py-2">{landingCopy.demo.nav[2]}</div>
        </nav>
      </aside>
      <div className="min-w-0 p-3.5 sm:p-4">
        <h3 className="inline-flex items-baseline gap-2 font-display text-base font-semibold leading-none text-[#10231d] sm:gap-2.5 sm:text-lg">
          <span className="font-display text-lg font-semibold tracking-[-0.04em] text-[#0a8059] sm:text-xl">{landingCopy.demo.sentCount}</span>
          <span>{landingCopy.demo.sentLabel}</span>
        </h3>
        <div className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-white sm:mt-3.5">
          {sentMessages.map((message, index) => (
            <div key={message.company} className={`${index > 1 ? "hidden sm:grid" : "grid"} grid-cols-[1fr_auto] gap-2 border-b border-black/[0.07] px-3 py-2.5 last:border-0 sm:grid-cols-[90px_1fr_auto]`}>
              <div className="truncate text-[10px] font-semibold text-[#10231d]">{message.company}</div>
              <div className="hidden truncate text-[9px] text-[#68736e] sm:block">{message.subject}</div>
              <div className="flex items-center gap-1.5 text-[8px] text-[#7d8782]">
                <span className={index === 3 ? "text-[#0a8059]" : ""}>{message.status}</span>
                <span>{message.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RepliesScreen() {
  return (
    <div className="h-[120px] overflow-hidden bg-[#eef3ef] p-3 sm:h-[240px] sm:p-4">
      <h3 className="inline-flex items-baseline gap-2 font-display text-base font-semibold leading-none text-[#10231d] sm:gap-2.5 sm:text-lg">
        <span className="font-display text-lg font-semibold tracking-[-0.04em] text-[#0a8059] sm:text-xl">{landingCopy.demo.repliesCount}</span>
        <span>{landingCopy.demo.repliesLabel}</span>
      </h3>
      <div className="mt-3 space-y-2 sm:mt-3.5">
        {clientReplies.map((reply, index) => (
          <div key={reply.name} className={`${index > 0 ? "hidden sm:block" : "block"} rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 shadow-[0_5px_14px_rgba(16,35,29,0.04)]`}>
            <div className="flex items-center gap-2.5">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[8px] font-bold ${index === 0 ? "bg-[#c8ff45] text-[#14351e]" : index === 1 ? "bg-[#dce9ff] text-[#1b4d87]" : "bg-[#ffe0d2] text-[#8c3a21]"}`}>
                {reply.name.split(" ").map((part) => part[0]).join("")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-semibold text-[#10231d]">{reply.name} <span className="font-normal text-[#7d8782]">· {reply.company}</span></div>
                <p className="mt-1 truncate text-[9px] text-[#47524d] sm:text-[10px]">«{reply.message}»</p>
              </div>
              <div className="text-right">
                <div className="text-[8px] text-[#8a948f]">{reply.time}</div>
                <div className="mt-1 rounded-full border border-[#9ad86f]/45 bg-[#ddf7d2] px-2 py-0.5 text-[7px] font-semibold text-[#28621f] sm:text-[8px]">{reply.status}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoForm({ onClose, source }: { onClose: () => void; source: string }) {
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus({ preventScroll: true });
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
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
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || landingCopy.demo.form.error);
      }
      setStatus("ok");
      form.reset();
    } catch (submitError) {
      setStatus("error");
      setError(submitError instanceof Error ? submitError.message : landingCopy.demo.form.error);
    }
  }

  if (status === "ok") {
    return (
      <div className="px-6 py-12 text-center sm:px-10">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#c8ff45] text-xl font-bold text-[#0b3b31]">✓</div>
        <h3 className="mt-5 font-display text-2xl font-semibold text-[#10231d]">{landingCopy.demo.form.successTitle}</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#68736e]">{landingCopy.demo.form.successText}</p>
        <button type="button" onClick={onClose} className="btn-primary mt-6 px-5 py-2.5 text-sm font-semibold">{landingCopy.demo.form.done}</button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="p-6 sm:p-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h3 className="font-display text-2xl font-semibold text-[#10231d] sm:text-3xl">{landingCopy.demo.form.title}</h3>
        </div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-xl text-[#68736e] transition hover:bg-black/[0.04]" aria-label={landingCopy.demo.form.closeAria}>×</button>
      </div>
      <div className="mt-7 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#47524d]">{landingCopy.demo.form.fields[0].label}</span>
          <input ref={nameInputRef} name="name" required autoComplete="name" className="w-full rounded-xl border border-black/10 bg-[#f7f8f5] px-4 py-3 text-sm text-[#10231d] outline-none transition focus:border-[#0a6a4c] focus:ring-2 focus:ring-[#c8ff45]/50" placeholder={landingCopy.demo.form.fields[0].placeholder} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#47524d]">{landingCopy.demo.form.fields[1].label}</span>
          <input name="company" required autoComplete="organization" className="w-full rounded-xl border border-black/10 bg-[#f7f8f5] px-4 py-3 text-sm text-[#10231d] outline-none transition focus:border-[#0a6a4c] focus:ring-2 focus:ring-[#c8ff45]/50" placeholder={landingCopy.demo.form.fields[1].placeholder} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#47524d]">{landingCopy.demo.form.fields[2].label}</span>
          <input name="contact" required autoComplete="email" className="w-full rounded-xl border border-black/10 bg-[#f7f8f5] px-4 py-3 text-sm text-[#10231d] outline-none transition focus:border-[#0a6a4c] focus:ring-2 focus:ring-[#c8ff45]/50" placeholder={landingCopy.demo.form.fields[2].placeholder} />
        </label>
      </div>
      {status === "error" && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
      <button type="submit" disabled={status === "loading"} className="btn-primary mt-5 w-full px-5 py-3.5 text-sm font-semibold disabled:cursor-wait disabled:opacity-60">
        {status === "loading" ? landingCopy.demo.form.loading : landingCopy.demo.form.submit}
      </button>
      <p className="mt-3 text-center text-[11px] text-[#7d8782]">{landingCopy.demo.form.note}</p>
    </form>
  );
}

export function DemoCtaSection() {
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
    <section id="cta" className="relative overflow-hidden bg-[#092d26] py-16 text-white md:py-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(200,255,69,0.12),transparent_34%),linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:auto,54px_54px,54px_54px]" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-3xl text-center">
          <div>
            <h2 className="text-balance font-display text-3xl font-semibold leading-[1.04] tracking-[-0.035em] sm:text-4xl md:text-5xl">{landingCopy.demo.title}</h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-white/64 sm:text-base">{landingCopy.demo.description}</p>
          </div>
        </div>

        <div className="relative mx-auto mt-8 grid max-w-5xl gap-10 sm:gap-12 lg:grid-cols-2 lg:gap-12">
          {[
            { key: "outbox", screen: <OutboxScreen /> },
            { key: "replies", screen: <RepliesScreen /> },
          ].map((item) => (
            <article key={item.key} className="overflow-hidden rounded-[22px] border border-white/15 bg-[#f7f8f5] shadow-[0_28px_70px_rgba(0,0,0,0.24)]">
              <div className="flex min-h-8 items-center justify-end border-b border-black/10 bg-[#fbfcf8] px-3 sm:min-h-9 sm:px-4">
                <div className="flex items-center gap-1.5" aria-hidden="true"><span className="h-2 w-2 rounded-full bg-[#ff806e]" /><span className="h-2 w-2 rounded-full bg-[#ffd15c]" /><span className="h-2 w-2 rounded-full bg-[#71d995]" /></div>
              </div>
              {item.screen}
            </article>
          ))}
          <div className="absolute left-1/2 top-1/2 z-10 flex h-8 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center text-white/55" aria-label={landingCopy.demo.transitionAria}>
            <svg aria-hidden="true" viewBox="0 0 40 20" fill="none" className="h-5 w-10 rotate-90 lg:rotate-0">
              <path d="M2 10h34m-6-5 6 5-6 5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div className="mx-auto mt-7 flex max-w-xl flex-col items-center text-center">
          <p className="font-display text-lg font-semibold text-white sm:text-xl">{landingCopy.demo.prompt}</p>
          <button type="button" onClick={() => { setDemoSource("demo-section"); setIsFormOpen(true); }} className="btn-white group mt-4 inline-flex min-h-16 w-full items-center justify-center gap-4 px-10 text-base font-semibold shadow-[0_18px_46px_rgba(0,0,0,0.24)] sm:w-auto sm:min-w-[360px]">
            {landingCopy.demo.button} <span className="text-xl transition-transform group-hover:translate-x-1">→</span>
          </button>
        </div>

        <div className="mt-10 overflow-hidden rounded-[22px] border border-white/12 bg-white/[0.055]">
          <blockquote className="flex items-center gap-5 px-5 py-7 sm:gap-8 sm:px-8">
            <footer className="flex shrink-0 flex-col items-center gap-2 sm:flex-row sm:gap-3">
              <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-white/20 bg-white/10">
                <Image
                  src="/clients/tvoy-zont-client.webp"
                  alt={landingCopy.demo.testimonial.imageAlt}
                  width={334}
                  height={334}
                  unoptimized
                  className="absolute -top-[18px] left-[-20px] h-auto w-[100px] max-w-none"
                />
              </span>
              <span className="text-center sm:min-w-[88px] sm:text-left">
                <span className="block text-sm font-semibold text-white/82">{landingCopy.demo.testimonial.name}</span>
                <span className="mt-0.5 block text-xs text-white/42">{landingCopy.demo.testimonial.role}</span>
              </span>
            </footer>
            <p className="min-w-0 flex-1 font-display text-[15px] leading-snug text-white/88 sm:text-lg lg:text-xl">{landingCopy.demo.testimonial.quote}</p>
          </blockquote>
        </div>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#061713]/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsFormOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label={landingCopy.demo.dialogAria} className="w-full max-w-lg overflow-hidden rounded-[24px] bg-white shadow-[0_35px_100px_rgba(0,0,0,0.45)]">
            <DemoForm onClose={() => setIsFormOpen(false)} source={demoSource} />
          </div>
        </div>
      )}
    </section>
  );
}
