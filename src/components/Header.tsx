import { Logo } from "./Logo";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm text-ink-700 md:flex">
          <a href="#pains" className="hover:text-slate-900 transition">Проблема</a>
          <a href="#how" className="hover:text-slate-900 transition">Как работает</a>
          <a href="#emails" className="hover:text-slate-900 transition">Письма</a>
          <a href="#features" className="hover:text-slate-900 transition">Возможности</a>
          <a href="#pricing" className="hover:text-slate-900 transition">Цена</a>
        </nav>
        <a
          href="#cta"
          className="rounded-full brand-gradient-vivid px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 glow"
        >
          Записаться на демо
        </a>
      </div>
    </header>
  );
}
