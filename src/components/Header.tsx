import { Logo } from "./Logo";
import { MobileMenu } from "./MobileMenu";
import { DemoTrigger } from "./DemoTrigger";
import Link from "next/link";
import { headerCopy } from "@/content/landing/header";

const landingCopy = { header: headerCopy };

const navItems = landingCopy.header.nav;

export function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full border border-white/60 bg-white/84 px-3 pl-4 shadow-[0_12px_34px_rgba(4,38,31,0.14)] backdrop-blur-xl sm:px-3 sm:pl-5">
        <Logo />
        <nav className="hidden items-center gap-1 text-sm text-ink-500 md:flex">
          {navItems.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="group relative px-3 py-2 font-medium transition-colors hover:text-[color:var(--foreground)]"
            >
              {n.label}
              <span
                aria-hidden="true"
                className="absolute inset-x-3 bottom-0 h-px origin-center scale-x-0 bg-[#0a6a4c] transition-transform duration-200 group-hover:scale-x-100"
              />
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden min-h-10 items-center px-2.5 text-sm font-medium text-ink-500 transition hover:text-[color:var(--foreground)] sm:flex"
          >
            {landingCopy.header.login}
          </Link>
          <DemoTrigger
            source="header"
            className="btn-primary flex min-h-10 items-center px-4 text-sm font-semibold sm:px-5"
          >
            <span className="sm:hidden">{landingCopy.header.demoShort}</span>
            <span className="hidden sm:inline">{landingCopy.header.demo}</span>
          </DemoTrigger>
          {/* на мобильных ссылки навигации скрыты — прячем их в бургер */}
          <MobileMenu items={navItems} />
        </div>
      </div>
    </header>
  );
}
