import type { ReactNode } from "react";
import Image from "next/image";
import { SignalBackdrop } from "@/components/SignalBackdrop";
import { commonCopy } from "@/content/landing/common";
import { featuresCopy } from "@/content/landing/features";

const landingCopy = { common: commonCopy, features: featuresCopy };

function ProductSurface({
  children,
  label,
  className = "",
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`overflow-hidden rounded-xl border border-black/[0.08] bg-white ${className}`}
    >
      {children}
    </div>
  );
}

function CampaignComposer() {
  const copy = landingCopy.features.mock.composer;
  return (
    <ProductSurface
      label={copy.aria}
      className="w-full shadow-[0_16px_34px_rgba(2,30,24,0.14)]"
    >
      <div className="flex h-10 items-center justify-between border-b border-line bg-[#fbfcfb] px-4 text-[10px] text-ink-500">
        <span className="font-semibold text-[color:var(--foreground)]">{copy.title}</span>
        <span>{copy.saved}</span>
      </div>
      <div className="grid min-h-[340px] grid-cols-[76px_1fr] bg-[#f7f9f8] sm:grid-cols-[132px_1fr]">
        <aside className="border-r border-white/10 bg-[#0c3027] p-2.5 text-white sm:p-4">
          <div className="font-display text-xs font-semibold">{landingCopy.common.brand}</div>
          <div className="mt-6 space-y-3 text-[8px] text-white/45 sm:mt-8 sm:space-y-4 sm:text-[9px]">
            {copy.nav.map((item, index) => <div key={item} className={index === 0 ? "text-white" : undefined}>{item}</div>)}
          </div>
        </aside>
        <div className="min-w-0 p-2.5 sm:p-5">
          <div className="flex items-center gap-1 text-[7px] font-semibold sm:gap-2 sm:text-[9px]">
            <span className="rounded-full bg-[#174b3c] px-2 py-1.5 text-white sm:px-3">{copy.steps[0]}</span>
            <span className="rounded-full border border-mint-300 bg-mint-50 px-2 py-1.5 text-mint-700 sm:px-3">{copy.steps[1]}</span>
            <span className="hidden rounded-full border border-line bg-white px-3 py-1.5 text-ink-500 min-[390px]:inline-flex">{copy.steps[2]}</span>
          </div>

          <div className="mt-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-[9px] uppercase tracking-[0.11em] text-ink-500">{copy.eyebrow}</div>
              <div className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">{copy.heading}</div>
            </div>
            <button type="button" tabIndex={-1} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[9px] font-semibold text-mint-700">
              {copy.rebuild}
            </button>
          </div>

          <div className="mt-3 rounded-lg border border-line bg-white p-3">
            <div className="text-[8px] uppercase tracking-[0.1em] text-ink-500">{copy.segmentLabel}</div>
            <div className="mt-1.5 inline-flex rounded-md bg-mint-50 px-2 py-1 text-[9px] font-medium text-mint-700">
              {copy.segment}
            </div>
          </div>

          <div className="mt-2 rounded-lg border border-line bg-white p-3">
            <div className="text-[8px] text-ink-500">{copy.subjectLabel}</div>
            <div className="mt-1 text-[10px] font-semibold text-[color:var(--foreground)]">
              {copy.subject}
            </div>
            <div className="mt-3 border-t border-line pt-3 text-[9px] leading-[1.55] text-ink-700">
              {copy.body}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-[8px] text-ink-500">
            <span>{copy.variables}</span>
            <span className="font-medium text-mint-700">{copy.unique}</span>
          </div>
        </div>
      </div>
    </ProductSurface>
  );
}

function DialogueInbox() {
  const copy = landingCopy.features.mock.dialog;
  return (
    <ProductSurface label={copy.aria} className="h-full">
      <div className="grid h-full min-h-[300px] grid-cols-[108px_1fr] sm:grid-cols-[176px_1fr]">
        <aside className="border-r border-line bg-[#f4f7f5] p-2.5 sm:p-4">
          <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-ink-500">
            <span>{copy.title}</span><span>{copy.threads.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {copy.threads.map(([name, line], index) => (
              <div key={name} className={`rounded-lg p-2.5 ${index === 0 ? "border border-line bg-white" : ""}`}>
                <div className="truncate text-[10px] font-semibold text-[color:var(--foreground)]">{name}</div>
                <div className="mt-1 truncate text-[8px] text-ink-500">{line}</div>
              </div>
            ))}
          </div>
        </aside>
        <div className="min-w-0 bg-white p-2.5 sm:p-5">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div>
              <div className="text-[11px] font-semibold text-[color:var(--foreground)]">{copy.person}</div>
              <div className="mt-0.5 text-[8px] text-ink-500">{copy.role}</div>
            </div>
            <span className="rounded-full bg-mint-50 px-2.5 py-1 text-[8px] font-semibold text-mint-700">{copy.aiStatus}</span>
          </div>
          <div className="mt-4 space-y-3">
            <div className="max-w-[84%] rounded-lg border border-line bg-[#fafbfa] p-3 text-[10px] leading-relaxed text-ink-700">
              {copy.messages[0]}
            </div>
            <div className="ml-auto max-w-[90%] rounded-lg border border-mint-200 bg-mint-50 p-3 text-[10px] leading-relaxed text-[#123a2e]">
              {copy.messages[1]}
              <div className="mt-1.5 text-right text-[8px] text-mint-700">{copy.sentStatus}</div>
            </div>
            <div className="max-w-[78%] rounded-lg border border-line bg-[#fafbfa] p-3 text-[10px] leading-relaxed text-ink-700">
              {copy.messages[2]}
            </div>
          </div>
        </div>
      </div>
    </ProductSurface>
  );
}

function MailboxFleet() {
  const copy = landingCopy.features.mock.mailboxes;

  return (
    <ProductSurface label={copy.aria} className="h-full">
      <div className="h-full bg-[#f7f9f8] p-4 sm:p-5">
        <div className="grid grid-cols-3 gap-2">
          {copy.metrics.map(([value, label]) => (
            <div key={label} className="rounded-lg border border-line bg-white p-2.5">
              <div className="font-display text-base font-semibold text-[#0d4a38]">{value}</div>
              <div className="mt-0.5 text-[8px] text-ink-500">{label}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white">
          {copy.rows.map(([email, state, score], index) => (
            <div key={email} className="flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-0">
              <span className={`h-2 w-2 rounded-full ${index === 1 ? "bg-[#e4ad4b]" : "bg-mint-500"}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[9px] font-medium text-[color:var(--foreground)]">{email}</div>
                <div className="mt-0.5 text-[8px] text-ink-500">{state}</div>
              </div>
              <span className="font-display text-[10px] font-semibold text-mint-700">{score}</span>
            </div>
          ))}
        </div>
      </div>
    </ProductSurface>
  );
}

function CrmHandoff() {
  const copy = landingCopy.features.mock.crm;
  return (
    <ProductSurface label={copy.aria} className="h-full">
      <div className="flex h-full flex-col bg-[#f7f9f8] p-3 sm:p-4">
        <div className="rounded-lg border border-line bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[color:var(--foreground)]">{copy.person}</div>
              <div className="mt-1 text-[9px] text-ink-500">{copy.role}</div>
            </div>
            <span className="rounded-full bg-[#103f34] px-2.5 py-1 text-[8px] font-semibold text-white">{copy.status}</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[9px]">
            <span className="text-ink-500">{copy.context}</span>
            <span className="rounded-md border border-mint-200 bg-mint-50 px-2.5 py-1.5 font-semibold text-mint-700">{copy.destination}</span>
          </div>
        </div>
      </div>
    </ProductSurface>
  );
}

function CampaignOverview() {
  const copy = landingCopy.features.mock.overview;

  return (
    <ProductSurface label={copy.aria} className="h-full">
      <div className="h-full bg-[#f7f9f8] p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {copy.metrics.map(([value, label]) => (
            <div key={label} className="rounded-lg border border-line bg-white p-2.5">
              <div className="font-display text-sm font-semibold text-[#0d4a38]">{value}</div>
              <div className="mt-0.5 text-[8px] text-ink-500">{label}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white">
          <div className="grid grid-cols-[1.2fr_.8fr_.8fr] gap-2 border-b border-line bg-[#f3f6f4] px-3 py-2 text-[8px] uppercase tracking-[0.08em] text-ink-500">
            {copy.columns.map((column) => <span key={column}>{column}</span>)}
          </div>
          {copy.rows.map(([person, company, status], index) => (
            <div key={person} className="grid grid-cols-[1.2fr_.8fr_.8fr] items-center gap-2 border-b border-line px-3 py-3 text-[9px] last:border-0">
              <span className="truncate font-medium text-[color:var(--foreground)]">{person}</span>
              <span className="truncate text-ink-500">{company}</span>
              <span className={`w-fit rounded-full px-2 py-1 text-[8px] font-semibold ${index === 0 ? "bg-[#103f34] text-white" : "bg-mint-50 text-mint-700"}`}>{status}</span>
            </div>
          ))}
        </div>
      </div>
    </ProductSurface>
  );
}

function FeatureCard({
  title,
  text,
  children,
  className,
}: {
  title: string;
  text: string;
  children: ReactNode;
  className: string;
}) {
  return (
    <article className={`group flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-white transition-[border-color,background-color] duration-300 hover:border-[#aebfb6] ${className}`}>
      <div className="p-6 pb-5 sm:p-7 sm:pb-6">
        <h3 className="font-display text-[22px] font-semibold leading-[1.06] text-[color:var(--foreground)] sm:text-2xl">{title}</h3>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-500">{text}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3 sm:px-4 sm:pb-4">
        <div
          className="h-full overflow-hidden rounded-xl bg-[#252726] p-2 sm:p-2.5"
          style={{ backgroundImage: "radial-gradient(circle at 88% 10%, rgba(255,255,255,.08), transparent 32%), radial-gradient(circle at 10% 90%, rgba(255,255,255,.04), transparent 28%)" }}
        >
          {children}
        </div>
      </div>
    </article>
  );
}

function ProductScreenshot({
  src,
  alt,
  position = "object-left-top",
  fit = "object-cover",
  background = "bg-[#0a1713]",
}: {
  src: string;
  alt: string;
  position?: string;
  fit?: string;
  background?: string;
}) {
  return (
    <div className={`relative h-full min-h-[190px] overflow-hidden rounded-lg ${background}`}>
      <Image
        src={src}
        alt={alt}
        fill
        unoptimized
        sizes="(max-width: 768px) 100vw, 58vw"
        className={`${fit} ${position}`}
      />
    </div>
  );
}

const secondaryFeatures = landingCopy.features.secondary;

export function ProductFeatures() {
  return (
    <section id="features" className="relative overflow-hidden bg-[#f3f6f2] py-20 md:py-32">
      <SignalBackdrop />
      <div className="relative z-10 mx-auto max-w-6xl px-5">
        <div className="max-w-3xl">
          <h2 className="font-display text-3xl font-semibold leading-[1.02] text-[color:var(--foreground)] md:text-5xl">
            {landingCopy.features.title}
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-500 md:text-lg">
            {landingCopy.features.description}
          </p>
        </div>

        <article className="mt-10 overflow-hidden rounded-[28px] border border-black/[0.08] bg-white sm:mt-12">
          <div className="p-6 sm:p-8 lg:p-10">
            <div className="max-w-3xl">
              <div className="inline-flex rounded-full border border-mint-200 bg-mint-50 px-3 py-1.5 text-xs font-semibold text-mint-800">
                {landingCopy.features.prospecting.eyebrow}
              </div>
              <h3 className="mt-5 max-w-xl font-display text-[28px] font-semibold leading-[1.02] text-[color:var(--foreground)] sm:text-4xl">
                {landingCopy.features.prospecting.title}
              </h3>
              <ol className="mt-7 grid overflow-hidden rounded-2xl border border-black/[0.08] bg-[#f4f8f5] sm:grid-cols-3">
                {landingCopy.features.prospecting.steps.map((step, index) => (
                  <li
                    key={step}
                    className="flex min-h-16 items-center gap-3 px-4 py-3.5 text-sm font-semibold leading-snug text-[#153f34] [&+li]:border-t [&+li]:border-black/[0.08] sm:min-h-20 sm:px-5 sm:[&+li]:border-l sm:[&+li]:border-t-0"
                  >
                    <span className="metric-number flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#153f34] text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                    {index < landingCopy.features.prospecting.steps.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className="ml-auto text-lg font-normal leading-none text-[#153f34]/35 rotate-90 sm:rotate-0"
                      >
                        →
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
            <div className="mt-8 grid items-start gap-4 lg:grid-cols-[0.68fr_1.32fr]">
              <figure className="overflow-hidden rounded-2xl border border-black/10 bg-[#132c25] p-1.5 shadow-[0_20px_45px_rgba(3,31,25,0.16)]">
                <div className="relative aspect-[650/810] overflow-hidden rounded-xl">
                  <Image src="/product-screens/prospecting-criteria-focus-hd.png" alt={landingCopy.features.prospecting.criteriaAlt} fill unoptimized sizes="(max-width: 1024px) 100vw, 34vw" className="object-cover" />
                </div>
              </figure>
              <figure className="overflow-hidden rounded-2xl border border-black/10 bg-[#132c25] p-1.5 shadow-[0_20px_45px_rgba(3,31,25,0.16)]">
                <div className="relative h-full min-h-[360px] overflow-hidden rounded-xl sm:min-h-[520px]">
                  <Image src="/product-screens/prospecting-results-focus-hd.png" alt={landingCopy.features.prospecting.resultsAlt} fill unoptimized sizes="(max-width: 1024px) 100vw, 58vw" className="object-cover object-left-top" />
                </div>
              </figure>
            </div>
          </div>
        </article>

        <div className="mt-10 grid auto-rows-auto gap-4 sm:mt-12 md:grid-cols-2 lg:grid-cols-12 lg:grid-rows-[306px_306px_430px]">
          <FeatureCard
            title={landingCopy.features.cards.composer.title}
            text={landingCopy.features.cards.composer.text}
            className="min-h-[520px] md:col-span-2 lg:col-span-8 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:min-h-0"
          >
            <div
              className="flex h-full items-center justify-center overflow-hidden rounded-lg bg-[#252726] p-2 sm:p-2.5"
              style={{ backgroundImage: "radial-gradient(circle at 88% 10%, rgba(255,255,255,.08), transparent 32%), radial-gradient(circle at 10% 90%, rgba(255,255,255,.04), transparent 28%)" }}
            >
              <div className="h-full w-full">
                <ProductScreenshot src="/product-screens/composer-focus-hd.png" alt="Персональное письмо в кампании Smailee" position="object-center" />
              </div>
            </div>
          </FeatureCard>

          <FeatureCard
            title={landingCopy.features.cards.dialog.title}
            text={landingCopy.features.cards.dialog.text}
            className="min-h-[440px] md:col-span-2 lg:col-span-7 lg:col-start-1 lg:row-start-3 lg:min-h-0"
          >
            <div
              className="h-full overflow-hidden rounded-lg bg-[#252726] p-2 sm:p-2.5"
              style={{ backgroundImage: "radial-gradient(circle at 88% 10%, rgba(255,255,255,.08), transparent 32%), radial-gradient(circle at 10% 90%, rgba(255,255,255,.04), transparent 28%)" }}
            >
              <div className="h-full w-full">
                <ProductScreenshot src="/product-screens/inbox-dialog-feature-hd.png" alt="AI-диалог с клиентом в Inbox Smailee" />
              </div>
            </div>
          </FeatureCard>

          <FeatureCard
            title={landingCopy.features.cards.inbox.title}
            text={landingCopy.features.cards.inbox.text}
            className="min-h-[340px] md:col-span-1 lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:min-h-0"
          >
            <ProductScreenshot
              src="/product-screens/inbox-list-tight-hd.png"
              alt="Список диалогов со статусами в Inbox Smailee"
              position="object-center"
              fit="object-contain"
              background="bg-white"
            />
          </FeatureCard>

          <FeatureCard
            title={landingCopy.features.cards.crm.title}
            text={landingCopy.features.cards.crm.text}
            className="min-h-[320px] md:col-span-1 lg:col-span-4 lg:col-start-9 lg:row-start-2 lg:min-h-0"
          >
            <ProductScreenshot src="/product-screens/integrations-bitrix-connected-hd.png" alt="Подключённая интеграция Smailee с Битрикс24 для передачи лидов" position="object-center" />
          </FeatureCard>

          <FeatureCard
            title={landingCopy.features.cards.overview.title}
            text={landingCopy.features.cards.overview.text}
            className="min-h-[430px] md:col-span-2 lg:col-span-5 lg:col-start-8 lg:row-start-3 lg:min-h-0"
          >
            <div
              className="h-full overflow-hidden rounded-lg bg-[#252726] p-2 sm:p-2.5"
              style={{ backgroundImage: "radial-gradient(circle at 88% 10%, rgba(255,255,255,.08), transparent 32%), radial-gradient(circle at 10% 90%, rgba(255,255,255,.04), transparent 28%)" }}
            >
              <div className="h-full w-full">
                <ProductScreenshot src="/product-screens/analytics-crop-hd.png" alt="Воронка коммуникаций в Smailee" position="object-left-bottom" />
              </div>
            </div>
          </FeatureCard>
        </div>

        <div className="mt-8 grid border-y border-line sm:grid-cols-2 lg:grid-cols-4">
          {secondaryFeatures.map(([title, text], index) => (
            <div key={title} className={`py-5 sm:px-5 ${index > 0 ? "border-t border-line sm:border-t-0" : ""} ${index % 2 === 1 ? "sm:border-l" : ""} ${index > 1 ? "sm:border-t lg:border-t-0" : ""} ${index > 0 ? "lg:border-l" : ""}`}>
              <div className="text-sm font-semibold text-[color:var(--foreground)]">{title}</div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
