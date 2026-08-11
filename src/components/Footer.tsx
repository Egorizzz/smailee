import Link from "next/link";
import { DemoTrigger } from "@/components/DemoTrigger";
import { commonCopy } from "@/content/landing/common";
import { footerCopy } from "@/content/landing/footer";

const landingCopy = { common: commonCopy, footer: footerCopy };

const footerGroups = landingCopy.footer.groups;

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-4 w-4">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer id="footer" className="relative overflow-hidden bg-[#061b15] text-white">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.045)_1px,transparent_1px)] [background-size:72px_72px]"
      />
      <div aria-hidden="true" className="absolute -right-32 -top-48 h-[520px] w-[520px] rounded-full bg-[#1e765c]/25 blur-[130px]" />

      <div className="relative mx-auto max-w-6xl px-5 pb-8 pt-20 md:pt-24">
        <div className="grid gap-10 border-b border-white/12 pb-16 md:grid-cols-[1fr_auto] md:items-end md:pb-20">
          <div className="max-w-3xl">
            <h2 className="text-balance font-display text-[32px] font-semibold leading-[1.06] tracking-[-0.035em] text-white sm:text-[40px] md:text-5xl">
              {landingCopy.footer.title}
            </h2>
          </div>
          <div className="flex items-start md:items-stretch">
            <DemoTrigger source="footer-cta" className="btn-white inline-flex min-h-12 items-center justify-center gap-3 px-6 text-sm font-semibold">
              {landingCopy.footer.button}
              <ArrowIcon />
            </DemoTrigger>
          </div>
        </div>

        <div className="grid gap-12 py-14 md:grid-cols-12 md:gap-8 md:py-16">
          <div className="md:col-span-5">
            <Link href="/" className="inline-flex items-center gap-3 text-white transition hover:opacity-80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/generated/logo.jpg" alt="" width={36} height={36} className="rounded-[10px]" />
              <span className="font-display text-xl font-semibold tracking-[-0.03em]">{landingCopy.common.brand}</span>
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-6 text-white/58">
              {landingCopy.footer.description}
            </p>
          </div>

          {footerGroups.map((group) => (
            <nav key={group.title} aria-label={group.title} className="md:col-span-2">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/42">{group.title}</h3>
              <ul className="mt-5 space-y-3 text-sm text-white/68">
                {group.links.map((link) => (
                  <li key={link.href + link.label}>
                    {link.href === "#cta" ? (
                      <DemoTrigger source="footer-link" className="transition hover:text-white">{link.label}</DemoTrigger>
                    ) : (
                      <a href={link.href} className="transition hover:text-white">{link.label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div className="md:col-span-3">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/42">{landingCopy.footer.contactTitle}</h3>
            <ul className="mt-5 space-y-3 text-sm text-white/68">
              <li><a href={`mailto:${landingCopy.footer.email}`} className="transition hover:text-white">{landingCopy.footer.email}</a></li>
              <li>
                <a href={landingCopy.footer.telegramUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 transition hover:text-white">
                  {landingCopy.footer.telegram}
                  <span aria-hidden="true" className="text-white/35">↗</span>
                </a>
              </li>
            </ul>
            <p className="mt-6 max-w-[15rem] text-xs leading-5 text-white/38">{landingCopy.footer.contactNote}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-white/10 pt-7 text-xs text-white/42 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {landingCopy.footer.copyright}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-x-5">
            <Link href="/terms" className="transition hover:text-white">{landingCopy.footer.terms}</Link>
            <a href={`mailto:${landingCopy.footer.email}?subject=${encodeURIComponent(landingCopy.footer.dataQuestions)}`} className="transition hover:text-white">{landingCopy.footer.dataQuestions}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
