import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { logoutAction } from "../(auth)/actions";

const nav = [
  { href: "/app", label: "Обзор", icon: "▦" },
  { href: "/app/onboarding", label: "Мой бизнес", icon: "◎" },
  { href: "/app/mailboxes", label: "Ящики", icon: "✉" },
  { href: "/app/contacts", label: "База контактов", icon: "☰" },
  { href: "/app/templates", label: "Шаблоны писем", icon: "▤" },
  { href: "/app/campaigns", label: "Кампании", icon: "➤" },
  { href: "/app/leads", label: "Лиды", icon: "★" },
  { href: "/app/suppressions", label: "Отписки", icon: "⊘" },
  { href: "/app/billing", label: "Тариф", icon: "₽" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      {/* sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="border-b border-line px-5 py-4">
          <Logo size="sm" href="/app" />
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-700 transition hover:bg-white hover:text-slate-900"
            >
              <span className="w-4 text-center text-ink-500">{n.icon}</span>
              {n.label}
            </Link>
          ))}
          {user.role === "ADMIN" && (
            <Link
              href="/app/admin"
              className="flex items-center gap-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
            >
              <span className="w-4 text-center">⚙</span>
              Админка
            </Link>
          )}
        </nav>
        <div className="border-t border-line p-3">
          <div className="px-3 py-2 text-xs text-ink-500 truncate">
            {user.email}
          </div>
          <form action={logoutAction}>
            <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-700 transition hover:bg-white">
              Выйти
            </button>
          </form>
        </div>
      </aside>

      {/* mobile top bar */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line px-5 py-3 md:hidden">
          <Logo size="sm" href="/app" />
          <form action={logoutAction}>
            <button className="text-sm text-ink-500">Выйти</button>
          </form>
        </header>
        <main className="flex-1 bg-white p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}
