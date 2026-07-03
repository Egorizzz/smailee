import Link from "next/link";
import { Logo } from "./Logo";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm text-ink-700 md:flex">
          <a href="#pains" className="hover:text-slate-900 transition">Проблема</a>
          <a href="#how" className="hover:text-slate-900 transition">Как работает</a>
          <a href="#features" className="hover:text-slate-900 transition">Возможности</a>
          <a href="#pricing" className="hover:text-slate-900 transition">Цена</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden text-sm font-medium text-ink-700 hover:text-slate-900 sm:block transition"
          >
            Войти
          </Link>
          <a
            href="#cta"
            className="rounded-full brand-gradient px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            Оставить заявку
          </a>
        </div>
      </div>
    </header>
  );
}
