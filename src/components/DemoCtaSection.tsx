import Image from "next/image";
import { DemoCtaInteractive } from "@/components/DemoCtaInteractive";
import { demoCopy } from "@/content/landing/demo";

const landingCopy = { demo: demoCopy };

function OutcomeScreen({
  src,
  alt,
  position = "object-left-top",
}: {
  src: string;
  alt: string;
  position?: string;
}) {
  return (
    <div className="bg-[#f7f8f5] p-3 sm:p-4">
      <div className="relative h-[210px] overflow-hidden rounded-xl border border-black/10 bg-white sm:h-[290px]">
        <Image src={src} alt={alt} fill unoptimized sizes="(max-width: 1024px) 100vw, 44vw" className={`object-cover ${position}`} />
      </div>
    </div>
  );
}

export function DemoCtaSection() {
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
            { key: "outbox", screen: <OutcomeScreen src="/product-screens/sent-funnel-hd.png" alt="Воронка отправленных писем в Smailee" /> },
            { key: "replies", screen: <OutcomeScreen src="/product-screens/warm-leads-tight-hd.png" alt="Тёплые лиды в Smailee" position="object-left-top" /> },
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
          <DemoCtaInteractive />
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

    </section>
  );
}
