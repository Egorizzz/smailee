"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { SignalBackdrop } from "@/components/SignalBackdrop";
import { commonCopy } from "@/content/landing/common";
import { howItWorksCopy } from "@/content/landing/how-it-works";

const landingCopy = { common: commonCopy, howItWorks: howItWorksCopy };

const walkthroughSteps = landingCopy.howItWorks.steps;
const scrollHold = 0.16;

function AppChrome({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-black/12 bg-white shadow-[0_24px_55px_rgba(3,31,25,0.22)]">
      <div className="flex h-9 items-center gap-2 border-b border-black/8 bg-[#f8faf8] px-3">
        <span className="h-2 w-2 rounded-full bg-[#ff776f]" />
        <span className="h-2 w-2 rounded-full bg-[#efc75e]" />
        <span className="h-2 w-2 rounded-full bg-[#63bd84]" />
        <span className="ml-2 min-w-0 truncate text-[10px] font-medium text-ink-500">{landingCopy.common.brand} · {title}</span>
      </div>
      {children}
    </div>
  );
}

function CampaignScreen() {
  const copy = landingCopy.howItWorks.mock.campaign;
  return (
    <AppChrome title={copy.windowTitle}>
      <div className="grid min-h-[300px] grid-cols-[78px_1fr] bg-[#f7f9f7] sm:grid-cols-[112px_1fr]">
        <aside className="border-r border-black/8 bg-[#0d3028] p-3 text-white">
          <div className="font-display text-[11px] font-semibold sm:text-xs">{landingCopy.common.brand}</div>
          <div className="mt-7 space-y-3 text-[8px] text-white/48 sm:text-[9px]">
            {copy.nav.map((item, index) => <div key={item} className={index === 0 ? "text-white" : undefined}>{item}</div>)}
          </div>
        </aside>
        <div className="min-w-0 p-3 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-ink-500">{copy.eyebrow}</div>
              <div className="mt-1 font-display text-sm font-semibold text-[#0a1512] sm:text-base">{copy.title}</div>
            </div>
            <span className="shrink-0 rounded-full bg-[#d9f0e4] px-2 py-1 text-[8px] font-semibold text-[#176246]">{copy.draft}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[10px] border border-black/8 bg-white p-3">
              <div className="text-[8px] uppercase tracking-[0.12em] text-ink-500">{copy.productLabel}</div>
              <div className="mt-2 text-[10px] font-semibold text-[#0a1512]">{copy.product}</div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-[#e8ede9]"><div className="h-full w-[82%] rounded-full bg-[#57a87f]" /></div>
              <div className="mt-1 text-[8px] text-ink-500">{copy.offerProgress}</div>
            </div>
            <div className="rounded-[10px] border border-black/8 bg-white p-3">
              <div className="text-[8px] uppercase tracking-[0.12em] text-ink-500">{copy.contactsLabel}</div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <span className="font-display text-lg font-semibold text-[#0a1512]">{copy.contacts}</span>
                <span className="text-[8px] text-[#176246]">{copy.uploadStatus}</span>
              </div>
              <div className="mt-2 flex gap-1">
                {copy.tags.map((tag) => <span key={tag} className="rounded bg-[#eef4f0] px-1.5 py-1 text-[7px] text-ink-700">{tag}</span>)}
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-[10px] border border-black/8 bg-white p-3">
            <div className="flex items-center justify-between text-[8px] text-ink-500"><span>{copy.sequenceLabel}</span><span>{copy.sequenceMeta}</span></div>
            <div className="mt-3 flex items-center gap-1.5">
              {copy.sequence.map((item, index) => (
                <div key={item} className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className={`flex h-6 min-w-0 flex-1 items-center justify-center rounded text-[7px] ${index === 0 ? "bg-[#176246] text-white" : "bg-[#edf2ee] text-ink-700"}`}>{item}</span>
                  {index < 3 && <span className="text-[8px] text-ink-500">›</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppChrome>
  );
}

function DialogScreen() {
  const copy = landingCopy.howItWorks.mock.dialog;
  return (
    <AppChrome title={copy.windowTitle}>
      <div className="grid min-h-[300px] grid-cols-[104px_1fr] bg-white sm:grid-cols-[160px_1fr]">
        <aside className="border-r border-black/8 bg-[#f5f8f5] p-2.5 sm:p-3">
          <div className="text-[8px] uppercase tracking-[0.12em] text-ink-500">{copy.inbox}</div>
          <div className="mt-3 space-y-1.5">
            {copy.threads.map(([name, line], index) => (
              <div key={name} className={`rounded-[8px] p-2 ${index === 0 ? "bg-white shadow-[0_1px_0_rgba(0,0,0,0.06)]" : ""}`}>
                <div className="truncate text-[8px] font-semibold text-[#0a1512] sm:text-[9px]">{name}</div>
                <div className="mt-0.5 truncate text-[7px] text-ink-500 sm:text-[8px]">{line}</div>
              </div>
            ))}
          </div>
        </aside>
        <div className="min-w-0 p-3 sm:p-4">
          <div className="flex items-center justify-between border-b border-black/8 pb-3">
            <div><div className="text-[10px] font-semibold text-[#0a1512]">{copy.person}</div><div className="text-[8px] text-ink-500">{copy.role}</div></div>
            <span className="rounded-full bg-[#d9f0e4] px-2 py-1 text-[7px] font-semibold text-[#176246]">{copy.aiStatus}</span>
          </div>
          <div className="mt-3 space-y-2.5">
            <div className="max-w-[82%] rounded-[10px] rounded-tl-[3px] bg-[#f0f3f0] px-3 py-2 text-[8px] leading-relaxed text-ink-700 sm:text-[9px]">
              {copy.messages[0]}
            </div>
            <div className="ml-auto max-w-[88%] rounded-[10px] rounded-tr-[3px] bg-[#e2f1e9] px-3 py-2 text-[8px] leading-relaxed text-[#123a2e] sm:text-[9px]">
              {copy.messages[1]}
              <div className="mt-1 text-right text-[7px] text-[#4d796a]">{copy.sentStatus}</div>
            </div>
            <div className="max-w-[78%] rounded-[10px] rounded-tl-[3px] bg-[#f0f3f0] px-3 py-2 text-[8px] leading-relaxed text-ink-700 sm:text-[9px]">
              {copy.messages[2]}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-[9px] border border-[#b9d8c8] bg-[#fbfdfb] px-3 py-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#3d9b70] motion-reduce:animate-none" />
            <span className="text-[8px] text-ink-500">{copy.typing}</span>
          </div>
        </div>
      </div>
    </AppChrome>
  );
}

function LeadsScreen() {
  const copy = landingCopy.howItWorks.mock.leads;

  return (
    <AppChrome title={copy.windowTitle}>
      <div className="min-h-[300px] bg-[#f6f8f6] p-3 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div><div className="text-[8px] uppercase tracking-[0.12em] text-ink-500">{copy.eyebrow}</div><div className="mt-1 font-display text-sm font-semibold text-[#0a1512] sm:text-base">{copy.title}</div></div>
          <span className="rounded-[7px] bg-[#123b30] px-2.5 py-1.5 text-[8px] font-semibold text-white">{copy.export}</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {copy.metrics.map(([value, label]) => (
            <div key={label} className="rounded-[9px] border border-black/7 bg-white p-2.5 sm:p-3">
              <div className="font-display text-base font-semibold text-[#0f4938] sm:text-xl">{value}</div>
              <div className="mt-0.5 text-[7px] text-ink-500 sm:text-[8px]">{label}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 overflow-hidden rounded-[10px] border border-black/8 bg-white">
          <div className="grid grid-cols-[1.25fr_.9fr_.65fr] gap-2 border-b border-black/7 bg-[#f2f5f2] px-3 py-2 text-[7px] uppercase tracking-[0.08em] text-ink-500">
            {copy.columns.map((column) => <span key={column}>{column}</span>)}
          </div>
          {copy.rows.map(([person, company, status], index) => (
            <div key={person} className="grid grid-cols-[1.25fr_.9fr_.65fr] items-center gap-2 border-b border-black/6 px-3 py-2.5 text-[8px] last:border-0 sm:text-[9px]">
              <span className="min-w-0 truncate font-medium text-[#0a1512]">{person}</span>
              <span className="min-w-0 truncate text-ink-500">{company}</span>
              <span className={`w-fit rounded-full px-1.5 py-1 text-[7px] font-semibold ${index === 0 ? "bg-[#123b30] text-white" : "bg-[#dff1e7] text-[#176246]"}`}>{status}</span>
            </div>
          ))}
        </div>
      </div>
    </AppChrome>
  );
}

function ProductScreen({ kind }: { kind: (typeof walkthroughSteps)[number]["kind"] }) {
  const screen = kind === "campaign"
    ? { src: "/product-screens/profile-ai-tight-hd.png", alt: "AI заполняет профиль компании по сайту в Smailee", position: "object-left-top" }
    : kind === "dialog"
      ? { src: "/product-screens/inbox-conversation-tight-hd.png", alt: "AI-диалог с клиентом в Inbox Smailee", position: "object-right-bottom" }
      : { src: "/product-screens/analytics-crop-hd.png", alt: "Воронка коммуникаций и тёплые лиды в Smailee", position: "object-left-top" };

  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-[14px] border border-black/12 bg-white shadow-[0_24px_55px_rgba(3,31,25,0.22)]">
      <Image
        src={screen.src}
        alt={screen.alt}
        fill
        unoptimized
        loading="eager"
        sizes="(max-width: 768px) 100vw, 56vw"
        className={`object-cover ${screen.position}`}
      />
    </div>
  );
}

export function HowItWorks() {
  const [activeStep, setActiveStep] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<number | null>(null);
  const swipeStartRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const horizontalWheelRef = useRef(0);

  useEffect(() => {
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncFromPageScroll = () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const section = sectionRef.current;
        if (!section) return;

        const stickyOffset = 64;
        const rect = section.getBoundingClientRect();
        const stickyHeight = window.innerHeight - stickyOffset;
        const travel = Math.max(1, section.offsetHeight - stickyHeight);
        const progress = Math.max(0, Math.min(1, (stickyOffset - rect.top) / travel));
        const carouselProgress = Math.max(
          0,
          Math.min(1, (progress - scrollHold) / (1 - scrollHold * 2)),
        );
        const position = carouselProgress * (walkthroughSteps.length - 1);
        const nextActiveStep = Math.round(position);
        const reducedMotion = reducedMotionQuery.matches;

        if (trackRef.current) {
          const visiblePosition = reducedMotion ? nextActiveStep : position;
          trackRef.current.style.transform = `translate3d(-${visiblePosition * 100}%, 0, 0)`;

          Array.from(trackRef.current.children).forEach((panel, index) => {
            const distance = Math.min(1, Math.abs(index - visiblePosition));
            (panel as HTMLElement).style.opacity = reducedMotion ? "1" : String(1 - distance * 0.24);
          });
        }

        if (progressRef.current) {
          progressRef.current.style.transform = `scaleX(${progress})`;
        }

        setActiveStep((current) => current === nextActiveStep ? current : nextActiveStep);
      });
    };

    syncFromPageScroll();
    window.addEventListener("scroll", syncFromPageScroll, { passive: true });
    window.addEventListener("resize", syncFromPageScroll);
    return () => {
      window.removeEventListener("scroll", syncFromPageScroll);
      window.removeEventListener("resize", syncFromPageScroll);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const goToStep = (index: number) => {
    const section = sectionRef.current;
    if (!section) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stickyOffset = 64;
    const sectionTop = window.scrollY + section.getBoundingClientRect().top;
    const stickyHeight = window.innerHeight - stickyOffset;
    const travel = Math.max(1, section.offsetHeight - stickyHeight);
    const carouselProgress = walkthroughSteps.length > 1 ? index / (walkthroughSteps.length - 1) : 0;
    const targetProgress = scrollHold + carouselProgress * (1 - scrollHold * 2);
    window.scrollTo({
      top: sectionTop - stickyOffset + travel * targetProgress,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  const goToAdjacentStep = (direction: -1 | 1) => {
    goToStep(Math.max(0, Math.min(walkthroughSteps.length - 1, activeStep + direction)));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    swipeStartRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.id !== event.pointerId) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    goToAdjacentStep(deltaX < 0 ? 1 : -1);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const horizontalDelta = event.shiftKey ? event.deltaY : event.deltaX;
    if (Math.abs(horizontalDelta) <= Math.abs(event.deltaY) && !event.shiftKey) return;

    horizontalWheelRef.current += horizontalDelta;
    if (Math.abs(horizontalWheelRef.current) < 40) return;

    event.preventDefault();
    goToAdjacentStep(horizontalWheelRef.current > 0 ? 1 : -1);
    horizontalWheelRef.current = 0;
  };

  return (
    <section ref={sectionRef} id="how" className="relative h-[260svh] bg-[#f3f6f2] md:h-[260vh]">
      <SignalBackdrop flip />
      <div className="sticky top-16 z-10 flex h-[calc(100svh-4rem)] items-start overflow-hidden py-4 md:items-center md:py-6">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-5">
          <div className="max-w-4xl">
            <h2 className="text-balance font-display text-[25px] font-semibold leading-[1.04] text-[color:var(--foreground)] sm:text-3xl md:text-[42px]">
              {landingCopy.howItWorks.title}
            </h2>
          </div>

          <div
            className="mt-3 overflow-hidden rounded-[16px] border border-[#cad8d0] bg-white touch-pan-y sm:mt-4 md:mt-5 md:rounded-[18px]"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => { swipeStartRef.current = null; }}
            onWheel={handleWheel}
          >
            <div className="relative flex border-b border-[#cad8d0] bg-[#f8faf8]" role="tablist" aria-label={landingCopy.howItWorks.tabsAria}>
              {walkthroughSteps.map((step, index) => (
                <button
                  key={step.tab}
                  type="button"
                  role="tab"
                  aria-selected={activeStep === index}
                  aria-controls={`how-panel-${index}`}
                  id={`how-tab-${index}`}
                  onClick={() => goToStep(index)}
                  className={`relative min-h-10 min-w-0 flex-1 border-r border-[#cad8d0] px-2 text-left text-[10px] font-semibold transition-colors duration-200 last:border-r-0 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-mint-600 sm:min-h-11 sm:text-sm md:min-h-14 md:px-6 ${activeStep === index ? "bg-[#e8f2ed] text-[#0d4a38]" : "text-ink-500 hover:bg-white hover:text-[color:var(--foreground)]"}`}
                >
                  {step.tab}
                </button>
              ))}
              <span
                ref={progressRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-[#216c50] will-change-transform"
              />
            </div>

            <div className="overflow-hidden bg-white">
              <div
                ref={trackRef}
                className="flex will-change-transform motion-reduce:transition-none"
              >
                {walkthroughSteps.map((step, index) => (
                  <article
                    key={step.tab}
                    id={`how-panel-${index}`}
                    role="tabpanel"
                    aria-labelledby={`how-tab-${index}`}
                    aria-hidden={activeStep !== index}
                    inert={activeStep !== index}
                    className="grid min-w-full transition-opacity duration-150 ease-out motion-reduce:transition-none md:grid-cols-[1.08fr_.92fr]"
                  >
                    <div
                      className="order-2 flex items-center overflow-hidden bg-[#252726] p-2 md:order-1 md:h-[450px] md:p-4 lg:p-5"
                      style={{ backgroundImage: "radial-gradient(circle at 88% 10%, rgba(255,255,255,.08), transparent 32%), radial-gradient(circle at 10% 90%, rgba(255,255,255,.04), transparent 28%)" }}
                    >
                      <div className="relative mx-auto h-[220px] w-full max-w-[650px] overflow-hidden sm:h-[250px] md:h-auto md:overflow-visible">
                        <div className="w-[135.2%] origin-top-left scale-[0.74] md:w-full md:scale-100">
                          <ProductScreen kind={step.kind} />
                        </div>
                      </div>
                    </div>
                    <div className="order-1 flex h-[165px] flex-col justify-center px-5 py-4 sm:h-[180px] sm:px-8 md:order-2 md:h-[450px] md:px-10 lg:px-14">
                      <h3 className="max-w-md font-display text-xl font-semibold leading-[1.06] text-[color:var(--foreground)] md:text-[29px] lg:text-[32px]">
                        {step.title}
                      </h3>
                      <p className="mt-3 max-w-md text-[12px] leading-relaxed text-ink-700 sm:text-sm md:mt-4 md:text-[15px]">{step.text}</p>
                      <div className="mt-3 hidden items-center gap-3 md:flex">
                        <button
                          type="button"
                          aria-label={landingCopy.howItWorks.previousStep}
                          disabled={index === 0}
                          onClick={() => goToStep(index - 1)}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#bdccc3] text-base text-[#164d3b] transition-colors duration-150 hover:bg-[#e8f2ed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint-600 disabled:cursor-default disabled:opacity-25"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          aria-label={landingCopy.howItWorks.nextStep}
                          disabled={index === walkthroughSteps.length - 1}
                          onClick={() => goToStep(index + 1)}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#bdccc3] text-base text-[#164d3b] transition-colors duration-150 hover:bg-[#e8f2ed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint-600 disabled:cursor-default disabled:opacity-25"
                        >
                          →
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3 text-[10px] font-semibold tabular-nums text-[#587066] md:hidden" aria-hidden="true">
            <span>{String(activeStep + 1).padStart(2, "0")}</span>
            <div className="h-px flex-1 bg-[#b8c8bf]" />
            <span>{String(walkthroughSteps.length).padStart(2, "0")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
