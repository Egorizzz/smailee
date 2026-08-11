import { Header } from "@/components/Header";
import { HowItWorks } from "@/components/HowItWorks";
import { ProductFeatures } from "@/components/ProductFeatures";
import { FaqSection } from "@/components/FaqSection";
import { PricingSection } from "@/components/PricingSection";
import { Footer } from "@/components/Footer";
import { DemoCtaSection } from "@/components/DemoCtaSection";
import { Reveal } from "@/components/Reveal";
import { ResetLandingScroll } from "@/components/ResetLandingScroll";
import { SignalBackdrop } from "@/components/SignalBackdrop";
import { DemoTrigger } from "@/components/DemoTrigger";
import Image from "next/image";
import heroImage from "./smailee-hero-v4.png";
import { commonCopy } from "@/content/landing/common";
import { heroCopy } from "@/content/landing/hero";
import { notForYouCopy, painsCopy } from "@/content/landing/pains";

const landingCopy = { common: commonCopy, hero: heroCopy, pains: painsCopy, notForYou: notForYouCopy };

const painCards = landingCopy.notForYou.cards;

function PainVisual({ type }: { type: (typeof painCards)[number]["visual"] }) {
  if (type === "inbox") {
    return (
      <svg viewBox="0 0 240 132" className="h-full w-full" fill="none" aria-hidden="true">
        <rect x="28" y="12" width="184" height="108" rx="14" fill="white" stroke="currentColor" strokeOpacity=".14" />
        <path d="M28 36h184" stroke="currentColor" strokeOpacity=".1" />
        <circle cx="43" cy="24" r="3" fill="#0e9f6e" />
        <circle cx="53" cy="24" r="3" fill="#7ce7b0" />
        <circle cx="63" cy="24" r="3" fill="currentColor" fillOpacity=".14" />
        <rect x="42" y="47" width="45" height="21" rx="6" fill="#edf6f1" />
        <rect x="97" y="47" width="45" height="21" rx="6" fill="#f1f5ff" />
        <rect x="152" y="47" width="45" height="21" rx="6" fill="#f7f8e9" />
        <path d="M50 59h20M105 59h20M160 59h20" stroke="currentColor" strokeOpacity=".28" strokeWidth="4" strokeLinecap="round" />
        <path d="M43 105V82c20 4 29-14 45-8 16 6 21 18 39 9 18-10 26-4 35-12 9-7 17-3 34-17v51H43Z" fill="#d8eee2" />
        <path d="M43 82c20 4 29-14 45-8 16 6 21 18 39 9 18-10 26-4 35-12 9-7 17-3 34-17" stroke="#0e9f6e" strokeWidth="3" strokeLinecap="round" />
        <circle cx="88" cy="74" r="3" fill="#0e9f6e" />
        <circle cx="127" cy="83" r="3" fill="#0e9f6e" />
        <circle cx="162" cy="71" r="3" fill="#0e9f6e" />
      </svg>
    );
  }

  if (type === "template") {
    return (
      <svg viewBox="0 0 240 132" className="h-full w-full" fill="none" aria-hidden="true">
        <rect x="24" y="32" width="192" height="42" rx="21" fill="white" stroke="currentColor" strokeOpacity=".16" />
        <circle cx="51" cy="53" r="10" stroke="#0a6a4c" strokeWidth="3" />
        <path d="m58 60 8 8" stroke="#0a6a4c" strokeWidth="3" strokeLinecap="round" />
        <path d="M78 49h91M78 60h61" stroke="currentColor" strokeOpacity=".2" strokeWidth="6" strokeLinecap="round" />
        <rect x="41" y="84" width="158" height="16" rx="8" fill="white" stroke="currentColor" strokeOpacity=".1" />
        <circle cx="54" cy="92" r="4" fill="#7ce7b0" />
        <path d="M66 92h71" stroke="currentColor" strokeOpacity=".18" strokeWidth="4" strokeLinecap="round" />
        <rect x="41" y="105" width="128" height="13" rx="6.5" fill="white" fillOpacity=".78" />
        <path d="M54 111.5h60" stroke="currentColor" strokeOpacity=".13" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === "funnel") {
    return (
      <svg viewBox="0 0 240 132" className="h-full w-full" fill="none" aria-hidden="true">
        <rect x="25" y="12" width="190" height="108" rx="14" fill="white" stroke="currentColor" strokeOpacity=".12" />
        <circle cx="94" cy="66" r="38" stroke="#e2e8e4" strokeWidth="17" />
        <circle cx="94" cy="66" r="38" stroke="#0e9f6e" strokeWidth="17" pathLength="100" strokeDasharray="82 18" strokeLinecap="round" transform="rotate(-90 94 66)" />
        <text x="94" y="72" fill="#0a1512" fontSize="20" fontWeight="700" textAnchor="middle" className="font-display">82%</text>
        <circle cx="153" cy="43" r="5" fill="#0e9f6e" />
        <path d="M165 43h28" stroke="currentColor" strokeOpacity=".24" strokeWidth="5" strokeLinecap="round" />
        <circle cx="153" cy="66" r="5" fill="#b9c8c0" />
        <path d="M165 66h20" stroke="currentColor" strokeOpacity=".16" strokeWidth="5" strokeLinecap="round" />
        <circle cx="153" cy="89" r="5" fill="#dce4df" />
        <path d="M165 89h14" stroke="currentColor" strokeOpacity=".11" strokeWidth="5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 240 132" className="h-full w-full" fill="none" aria-hidden="true">
      <rect x="27" y="10" width="186" height="112" rx="14" fill="white" stroke="currentColor" strokeOpacity=".15" />
      <path d="M27 38h186M63 10v28M177 10v28" stroke="currentColor" strokeOpacity=".13" />
      <circle cx="45" cy="24" r="4" fill="#0e9f6e" />
      <path d="M76 25h88" stroke="currentColor" strokeOpacity=".15" strokeWidth="6" strokeLinecap="round" />
      {([
        [42, 48, "#d1efe1"], [74, 48, "#e7efe9"], [106, 48, "#d1efe1"], [138, 48, "#e7efe9"], [170, 48, "#d1efe1"],
        [42, 66, "#e7efe9"], [74, 66, "#0e9f6e"], [106, 66, "#d1efe1"], [138, 66, "#0e9f6e"], [170, 66, "#e7efe9"],
        [42, 84, "#d1efe1"], [74, 84, "#e7efe9"], [106, 84, "#0e9f6e"], [138, 84, "#d1efe1"], [170, 84, "#0e9f6e"],
        [42, 102, "#0e9f6e"], [74, 102, "#d1efe1"], [106, 102, "#e7efe9"], [138, 102, "#0e9f6e"], [170, 102, "#d1efe1"],
      ] as const).map(([x, y, fill]) => <rect key={`${x}-${y}`} x={x} y={y} width="24" height="11" rx="4" fill={fill} />)}
    </svg>
  );
}

function BrokenChannelsCollage() {
  return (
    <div
      className="relative mx-auto aspect-[10/9] w-full max-w-[570px] sm:aspect-[15/16]"
      aria-label={landingCopy.pains.collageAria}
    >
      <div className="absolute left-0 top-[7%] z-30 w-[38%] -rotate-[5deg] overflow-hidden rounded-[24px] border border-black/10 bg-white shadow-[0_28px_55px_rgba(10,21,18,0.18)]">
        <div className="relative aspect-[9/19]">
          <Image
            src="/generated/telegram-cold-outreach-v4.png"
            alt="Список холодных сообщений в Telegram без ответов"
            fill
            sizes="(max-width: 768px) 38vw, 220px"
            className="object-fill"
          />
        </div>
      </div>

      <div className="absolute left-[31%] top-[2%] z-20 w-[38%] rotate-[1.5deg] overflow-hidden rounded-[24px] border border-white/10 bg-[#252726] text-white shadow-[0_30px_65px_rgba(10,21,18,0.22)]">
        <div className="relative aspect-[9/19]">
          <Image
            src="/generated/networking-story-v3.png"
            alt="Telegram-история с неэффективного нетворкинг-мероприятия"
            fill
            sizes="(max-width: 768px) 38vw, 220px"
            className="object-cover"
          />
        </div>
      </div>

      <div className="absolute right-[-4%] top-[7%] z-10 w-[38%] rotate-[5deg] overflow-hidden rounded-[24px] border border-black/10 bg-white shadow-[0_32px_65px_rgba(10,21,18,0.2)]">
        <div className="relative aspect-[9/19]">
          <Image
            src="/generated/bank-marketing-spend-v1.png"
            alt="История банковских списаний на маркетинг на сумму 218 000 рублей"
            fill
            sizes="(max-width: 768px) 38vw, 220px"
            className="object-cover"
          />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <ResetLandingScroll />
      <Header />

      {/* ── HERO: полноэкранная композиция по мотивам Mercury ── */}
      <section className="relative isolate h-[100svh] min-h-[640px] overflow-hidden bg-[#063d32] text-white">
        <div className="absolute inset-x-0 -top-10 bottom-0 -z-20">
          <Image
            src={heroImage}
            alt={landingCopy.hero.imageAlt}
            fill
            priority
            sizes="100vw"
            className="scale-[1.008] object-cover object-[62%_72%] blur-[1.1px] md:object-[center_72%]"
          />
        </div>
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(2,28,24,0.32)_0%,rgba(2,39,32,0.06)_48%,rgba(2,25,21,0.44)_100%)]" />
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,25,20,0.06)_72%,rgba(0,18,15,0.2)_100%)]" />
        <div className="hero-grain absolute inset-0 -z-[5]" aria-hidden="true" />

        <div className="relative z-10 mx-auto flex h-full w-full max-w-6xl flex-col items-start px-5 pb-5 pt-10 text-left md:pt-14">
          <div className="flex max-w-3xl flex-1 flex-col items-start justify-center pb-14 md:-translate-y-10">
            <h1 className="hero-heading-contrast font-display max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[-0.04em] text-white sm:text-5xl md:text-6xl">
              {landingCopy.hero.title}
            </h1>
            <p className="hero-text-contrast mt-6 max-w-2xl text-base leading-relaxed text-white/92 sm:text-lg md:text-xl">
              {landingCopy.hero.description}
            </p>
            <div className="mt-9 flex w-fit max-w-full flex-row items-stretch gap-3">
              <DemoTrigger
                source="hero"
                className="btn-white flex min-h-12 shrink-0 items-center justify-center whitespace-nowrap px-6 text-center text-sm font-semibold"
              >
                <span className="sm:hidden">{landingCopy.hero.demoShort}</span>
                <span className="hidden sm:inline">{landingCopy.hero.demo}</span>
              </DemoTrigger>
              <a
                href="#how"
                className="btn-glass flex min-h-12 shrink-0 items-center justify-center whitespace-nowrap px-6 text-center text-sm font-medium"
              >
                {landingCopy.hero.learnMore}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── ПРОБЛЕМНАЯ СИТУАЦИЯ: несвязанные каналы холодных продаж ── */}
      <section id="pains" className="relative overflow-hidden bg-[#f3f6f2] py-20 md:py-32">
        <SignalBackdrop />
        <div className="relative z-10 mx-auto grid max-w-6xl gap-8 px-5 md:grid-cols-2 md:items-center md:gap-14 lg:gap-20">
          <Reveal>
            <BrokenChannelsCollage />
          </Reveal>
          <Reveal>
            <div className="max-w-xl">
              <h2 className="mt-5 font-display text-3xl font-semibold leading-[1.06] text-[color:var(--foreground)] md:text-5xl">
                {landingCopy.pains.title}
              </h2>
              <p className="mt-6 text-base leading-relaxed text-ink-700 md:text-lg">
                {landingCopy.pains.description}
              </p>
              <p className="mt-5 text-base leading-relaxed text-ink-700 md:text-lg">
                {landingCopy.pains.conclusion}
              </p>
              <p className="mt-5 text-base font-semibold leading-relaxed text-mint-700 md:text-lg">
                {landingCopy.pains.punchline}
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── КАК РАБОТАЕТ: пошаговый product walkthrough ── */}
      <HowItWorks />

      {/* ── ВОЗМОЖНОСТИ: продуктовая bento-демонстрация ── */}
      <ProductFeatures />

      {/* ── БОЛИ: инвертированный сценарий в духе Cycle ── */}
      <section id="not-for-you" className="relative overflow-hidden bg-white pb-14 pt-20 md:py-36">
        <SignalBackdrop flip />
        <div className="relative z-10 mx-auto max-w-6xl px-5">
          <Reveal>
            <div className="mx-auto max-w-5xl text-center">
              <h2 className="font-display text-3xl font-semibold text-[color:var(--foreground)] md:text-5xl md:whitespace-nowrap">
                {landingCopy.notForYou.titleStart} <span className="text-mint-700">{landingCopy.notForYou.titleAccent}</span> {landingCopy.notForYou.titleEnd}
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-ink-700">
                {landingCopy.notForYou.description}
              </p>
            </div>
          </Reveal>

          <div className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-4">
            {painCards.map((card, i) => (
              <Reveal key={card.label} delay={i * 60}>
                <article className={`group grid h-full min-h-[390px] grid-rows-[192px_1fr] overflow-hidden rounded-xl border border-line ${card.tone}`}>
                  <div className="h-[192px] overflow-hidden p-5 text-[color:var(--foreground)] transition-transform duration-500 ease-out group-hover:-translate-y-1">
                    <PainVisual type={card.visual} />
                  </div>
                  <div className="min-h-[190px] border-t border-black/[0.06] bg-white/55 p-6 backdrop-blur-sm">
                    <h3 className="font-display text-xl font-semibold leading-tight text-[color:var(--foreground)]">
                      {card.label}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-ink-700">{card.text}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <PricingSection />

      <DemoCtaSection />

      <FaqSection />

      <Footer />
    </>
  );
}
