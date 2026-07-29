import { Logo } from "./Logo";
import { MobileMenu } from "./MobileMenu";

const navItems = [
  { href: "#pains", label: "Проблема" },
  { href: "#how", label: "Как работает" },
  { href: "#emails", label: "Письма" },
  { href: "#features", label: "Возможности" },
  { href: "#pricing", label: "Цена" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-[color:var(--background)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm text-ink-500 md:flex">
          {navItems.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="transition hover:text-[color:var(--foreground)]"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a
            href="#cta"
            className="rounded-lg bg-mint-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-mint-600"
          >
            Попробовать
          </a>
          {/* на мобильных ссылки навигации скрыты — прячем их в бургер */}
          <MobileMenu items={navItems} />
        </div>
      </div>
    </header>
  );
}
