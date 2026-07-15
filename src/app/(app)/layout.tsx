import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { logoutAction } from "../(auth)/actions";
import { SidebarNav } from "./SidebarNav";

// TO BE (R1): меню повторяет путь пользователя — сверху ежедневное
// (Лиды, Кампании), ниже настроечное. 5 разделов вместо 10:
// Инбокс слит с Лидами; Шаблоны — шаг «Оформление» в кампании; Отписки —
// таб в Контактах; Мой бизнес и Тариф — в Настройках.
const nav = [
  { href: "/app/leads", label: "Лиды", icon: "★" },
  { href: "/app/campaigns", label: "Кампании", icon: "➤" },
  { href: "/app/contacts", label: "Контакты", icon: "☰" },
  { href: "/app/mailboxes", label: "Инфраструктура", icon: "✉" },
  { href: "/app/settings", label: "Настройки", icon: "⚙" },
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
      {/* sidebar — тёмный, 240px, изумрудный индикатор активного пункта */}
      <aside className="hidden w-60 shrink-0 flex-col bg-dark-bg text-white/70 md:flex">
        <div className="px-5 py-4">
          <span className="font-display inline-flex items-center gap-2 text-base font-semibold text-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/generated/logo-test.png" alt="" width={26} height={26} className="rounded-lg" />
            Smailee
          </span>
        </div>
        <SidebarNav items={nav} />
        {user.role === "ADMIN" && (
          <div className="px-3 pb-2">
            <Link
              href="/app/admin"
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
            >
              <span className="w-4 text-center">▦</span>
              Админка
            </Link>
          </div>
        )}
        <div className="border-t border-white/10 p-3">
          <div className="truncate px-3 py-2 text-xs text-white/40">{user.email}</div>
          <form action={logoutAction}>
            <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/5">
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
