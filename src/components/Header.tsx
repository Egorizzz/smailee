import { Logo } from "./Logo";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-[color:var(--background)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm text-ink-500 md:flex">
          <a href="#pains" className="transition hover:text-[color:var(--foreground)]">Проблема</a>
          <a href="#how" className="transition hover:text-[color:var(--foreground)]">Как работает</a>
          <a href="#emails" className="transition hover:text-[color:var(--foreground)]">Письма</a>
          <a href="#features" className="transition hover:text-[color:var(--foreground)]">Возможности</a>
          <a href="#pricing" className="transition hover:text-[color:var(--foreground)]">Цена</a>
        </nav>
        <a
          href="#cta"
          className="rounded-lg bg-mint-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-mint-600"
        >
          Попробовать
        </a>
      </div>
    </header>
  );
}
