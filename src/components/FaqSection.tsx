import { Reveal } from "@/components/Reveal";
import { SignalBackdrop } from "@/components/SignalBackdrop";
import { faqCopy } from "@/content/landing/faq";

const landingCopy = { faq: faqCopy };

const FAQ_ITEMS = landingCopy.faq.items;

export function FaqSection() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="relative overflow-hidden border-t border-white/10 bg-dark-bg text-white"
    >
      <SignalBackdrop variant="dark" />
      <div className="relative z-10 mx-auto max-w-5xl px-5 py-24 md:py-32">
        <Reveal>
          <h2
            id="faq-title"
            className="text-center font-display text-4xl font-semibold tracking-[-0.02em] md:text-5xl"
          >
            {landingCopy.faq.title} <span className="text-white/40">{landingCopy.faq.titleMuted}</span>
          </h2>
        </Reveal>

        <Reveal className="mt-12 md:mt-16">
          <div className="border-t border-white/15">
            {FAQ_ITEMS.map((item, index) => (
              <details
                key={item.question}
                open={index === 0 ? true : undefined}
                className="group border-b border-white/15"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-8 py-6 text-left text-lg font-medium text-white outline-none transition-colors duration-300 hover:text-mint-200 focus-visible:text-mint-200 md:py-7 md:text-xl [&::-webkit-details-marker]:hidden">
                  <span>{item.question}</span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    fill="none"
                    className="h-4 w-4 shrink-0 text-white/55 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none"
                  >
                    <path
                      d="m3 6 5 5 5-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </summary>
                <div className="grid -translate-y-1 grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity,transform] duration-[220ms] ease-in-out group-open:translate-y-0 group-open:grid-rows-[1fr] group-open:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-opacity motion-reduce:duration-100">
                  <div className="min-h-0 overflow-hidden">
                    <p className="-mt-2 max-w-3xl pb-7 pr-12 text-sm leading-7 text-white/60 md:text-base">
                      {item.answer}
                    </p>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
