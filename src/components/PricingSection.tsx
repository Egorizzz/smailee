import { PAID_PLAN_KEYS, PLANS } from "@/lib/plans";
import { Reveal } from "@/components/Reveal";
import { SignalBackdrop } from "@/components/SignalBackdrop";
import { DemoTrigger } from "@/components/DemoTrigger";
import { pricingCopy } from "@/content/landing/pricing";

const landingCopy = { pricing: pricingCopy };

const START_UNIT_ECONOMICS = {
  contacts: 2000,
  replyRate: 0.06,
  dealRate: 0.15,
} as const;

const START_REPLIES = Math.round(
  START_UNIT_ECONOMICS.contacts * START_UNIT_ECONOMICS.replyRate,
);
const START_CLIENTS = Math.round(START_REPLIES * START_UNIT_ECONOMICS.dealRate);
const START_COST_PER_CLIENT = Math.round(PLANS.START.priceRub / START_CLIENTS);

function PlanFeatureIcon({
  kind,
  inverted,
}: {
  kind: "contacts" | "emails" | "dialog";
  inverted: boolean;
}) {
  return (
    <span
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
        inverted
          ? "border-white/15 bg-white/10 text-mint-200"
          : "border-mint-200 bg-mint-50 text-mint-700"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
        {kind === "contacts" && (
          <>
            <circle cx="8" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3.75 15c.45-2.45 1.8-3.7 4.25-3.7s3.8 1.25 4.25 3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M13 5.2a2.3 2.3 0 0 1 0 4.4M14 11.4c1.35.45 2.15 1.55 2.45 3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </>
        )}
        {kind === "emails" && (
          <>
            <rect x="2.75" y="4.25" width="14.5" height="11.5" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
            <path d="m4.25 6 5.75 4.5L15.75 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {kind === "dialog" && (
          <>
            <path d="M3 4.5h10a2 2 0 0 1 2 2v4.25a2 2 0 0 1-2 2H8l-3.5 2v-2.35A2 2 0 0 1 3 10.5v-6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M6 7.5h6M6 10h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </>
        )}
      </svg>
    </span>
  );
}

export function PricingSection() {
  return (
    <section id="pricing" className="relative overflow-hidden bg-white pb-20 pt-14 md:py-36">
      <SignalBackdrop flip />
      <div className="relative z-10 mx-auto max-w-6xl px-5">
        <Reveal>
          <div className="grid gap-8 sm:gap-10 lg:grid-cols-12 lg:gap-6">
            <div className="lg:col-span-3 lg:pr-5">
              <h2 className="text-balance font-display text-3xl font-semibold leading-[1.08] text-[color:var(--foreground)] md:text-4xl">
                {landingCopy.pricing.title}
              </h2>
              <p className="mt-5 max-w-sm text-sm leading-6 text-ink-700">
                {landingCopy.pricing.description}
              </p>
            </div>

            <div id="pricing-plans" className="grid gap-4 sm:grid-cols-3 lg:col-span-9">
              {PAID_PLAN_KEYS.map((key) => {
                const plan = PLANS[key];
                const isRecommended = key === "START";

                return (
                  <article
                    key={key}
                    style={isRecommended ? {
                      backgroundColor: "var(--dark-deep)",
                      backgroundImage: "radial-gradient(circle at 92% 3%, rgba(200,255,69,.16), transparent 32%), radial-gradient(circle at 2% 100%, rgba(159,197,245,.1), transparent 30%)",
                    } : undefined}
                    className={`flex min-h-[440px] flex-col rounded-xl border p-6 shadow-[0_12px_30px_rgba(6,18,14,0.05)] transition-[transform,border-color,background-color] duration-200 ease-out hover:-translate-y-1 motion-reduce:transform-none motion-reduce:transition-none ${
                      isRecommended
                        ? "border-dark-deep text-white"
                        : "border-line bg-white text-[color:var(--foreground)]"
                    }`}
                  >
                    <div className="flex min-h-6 items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.08em]">
                        {plan.name}
                      </h3>
                      {isRecommended && (
                        <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/80">
                          {landingCopy.pricing.recommended}
                        </span>
                      )}
                    </div>

                    <div className="mt-6 flex items-end gap-1.5">
                      <span className="font-display text-[38px] font-semibold leading-none tracking-[-0.05em]">
                        {plan.priceRub.toLocaleString("ru-RU")}
                      </span>
                      <span className={`shrink-0 whitespace-nowrap pb-1 text-xs ${isRecommended ? "text-white/55" : "text-ink-500"}`}>
                        {landingCopy.pricing.priceSuffix}
                      </span>
                    </div>

                    <p className={`mt-5 min-h-12 text-sm leading-6 ${isRecommended ? "text-white/65" : "text-ink-700"}`}>
                      {landingCopy.pricing.planDescriptions[key]}
                    </p>

                    <DemoTrigger
                      source={`pricing-${key.toLowerCase()}`}
                      className={`mt-6 flex min-h-11 items-center justify-center px-4 text-sm font-semibold ${
                        isRecommended
                          ? "btn-white"
                          : "btn-primary"
                      }`}
                    >
                      {landingCopy.pricing.demo} <span aria-hidden="true" className="ml-1.5">→</span>
                    </DemoTrigger>

                    <div className={`my-6 border-t ${isRecommended ? "border-white/15" : "border-line"}`} />

                    <ul className={`space-y-3 text-xs leading-5 ${isRecommended ? "text-white/75" : "text-ink-700"}`}>
                      <li className="flex items-start gap-3">
                        <PlanFeatureIcon kind="contacts" inverted={isRecommended} />
                        <span className="pt-1.5">
                          {landingCopy.pricing.contactsPrefix} <span className="font-display font-medium">{plan.maxContacts.toLocaleString("ru-RU")}</span> {landingCopy.pricing.contactsSuffix}
                        </span>
                      </li>
                      <li className="flex items-start gap-3">
                        <PlanFeatureIcon kind="emails" inverted={isRecommended} />
                        <span className="pt-1.5">
                          {landingCopy.pricing.contactsPrefix} <span className="font-display font-medium">{plan.maxEmailsPerMonth.toLocaleString("ru-RU")}</span> {landingCopy.pricing.emailsSuffix}
                        </span>
                      </li>
                      <li className="flex items-start gap-3">
                        <PlanFeatureIcon kind="dialog" inverted={isRecommended} />
                        <span className="pt-1.5">{landingCopy.pricing.dialogs}</span>
                      </li>
                      {isRecommended && (
                        <li className="rounded-[10px] border border-white/15 bg-white/[0.07] p-4">
                          <div className="flex items-end justify-between gap-6 sm:gap-3">
                            <p className="max-w-24 text-[11px] leading-[1.35] text-white/55">
                              {landingCopy.pricing.unitTitle}
                            </p>
                            <p className="shrink-0 text-right text-mint-200">
                              <span className="font-display text-[25px] font-semibold leading-none tracking-[-0.04em]">
                                ≈ {START_COST_PER_CLIENT} ₽
                              </span>
                            </p>
                          </div>

                          <div className="mt-4 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5 text-center">
                            <span className="font-display text-[11px] font-medium text-white">
                              {START_UNIT_ECONOMICS.contacts.toLocaleString("ru-RU")}
                              <span className="mt-0.5 block font-sans text-[9px] font-normal text-white/45">{landingCopy.pricing.funnelLabels[0]}</span>
                            </span>
                            <span aria-hidden="true" className="text-[11px] text-white/25">→</span>
                            <span className="font-display text-[11px] font-medium text-white">
                              {START_REPLIES}
                              <span className="mt-0.5 block font-sans text-[9px] font-normal text-white/45">{landingCopy.pricing.funnelLabels[1]}</span>
                            </span>
                            <span aria-hidden="true" className="text-[11px] text-white/25">→</span>
                            <span className="font-display text-[11px] font-medium text-mint-200">
                              {START_CLIENTS}
                              <span className="mt-0.5 block font-sans text-[9px] font-normal text-white/45">{landingCopy.pricing.funnelLabels[2]}</span>
                            </span>
                          </div>

                          <p className="mt-3 border-t border-white/10 pt-3 text-[9px] leading-4 text-white/40">
                            {landingCopy.pricing.unitNote}
                          </p>
                        </li>
                      )}
                    </ul>
                  </article>
                );
              })}
            </div>
          </div>
        </Reveal>
        <Reveal>
          <div className="mt-6 flex flex-col gap-3 rounded-xl border border-mint-200 bg-mint-50 px-5 py-4 text-sm text-[#14351e] sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="font-semibold">14 дней «Стандартного» бесплатно после выдачи кабинета.</span>{" "}
              Без привязки карты. По окончании данные сохраняются, а рассылки приостанавливаются до оплаты.
            </div>
            <DemoTrigger source="pricing-trial" className="btn-primary shrink-0 px-5 py-2.5 text-sm font-semibold">
              Записаться на демо →
            </DemoTrigger>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
