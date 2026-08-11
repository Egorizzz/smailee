import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { can, requireWorkspace } from "@/lib/organization";
import { Logo } from "@/components/Logo";
import { logoutAction } from "../(auth)/actions";
import { SidebarNav } from "./SidebarNav";
import { MobileNav } from "./MobileNav";
import { prisma } from "@/lib/prisma";

// TO BE (R1): меню повторяет путь пользователя — сверху ежедневное
// (Лиды, Кампании), ниже настроечное. 5 разделов вместо 10:
// Инбокс слит с Лидами; Шаблоны — шаг «Оформление» в кампании; Отписки —
// таб в Контактах; Мой бизнес и Тариф — в Настройках.
// short — подпись для нижней таб-панели на телефоне: в ячейку ~75px
// «Инфраструктура» не влезает и обрезается многоточием
const baseNav = [
  { href: "/app/leads", label: "Лиды", icon: "★" },
  { href: "/app/campaigns", label: "Кампании", icon: "➤" },
  { href: "/app/contacts", label: "Контакты", icon: "☰" },
  { href: "/app/mailboxes", label: "Инфраструктура", short: "Ящики", icon: "✉" },
  { href: "/app/settings", label: "Настройки", icon: "⚙" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (!user.acceptedTermsAt) redirect("/accept-terms");
  const workspace = await requireWorkspace();
  const incidents = workspace.role === "ORG_ADMIN"
    ? await prisma.systemApiIncident.findMany({ where: { resolvedAt: null }, orderBy: { lastFailedAt: "desc" } })
    : [];
  const nav = baseNav.filter((item) => {
    if (item.href === "/app/settings") return workspace.role === "ORG_ADMIN";
    if (item.href === "/app/mailboxes") return can(workspace, "INFRASTRUCTURE_MANAGE");
    if (item.href === "/app/contacts") return can(workspace, "CONTACTS_VIEW") || can(workspace, "CONTACTS_MANAGE");
    if (item.href === "/app/campaigns") return can(workspace, "CAMPAIGNS_CREATE") || can(workspace, "CAMPAIGNS_VIEW_ALL") || can(workspace, "CAMPAIGNS_MANAGE_OWN") || can(workspace, "CAMPAIGNS_MANAGE_ALL");
    if (item.href === "/app/leads") return can(workspace, "LEADS_VIEW_ALL") || can(workspace, "LEADS_REPLY_OWN") || can(workspace, "LEADS_REPLY_ALL");
    return true;
  });

  return (
    <div className="flex min-h-screen">
      {/* sidebar — тёмный, 240px, изумрудный индикатор активного пункта */}
      <aside className="hidden w-60 shrink-0 flex-col bg-dark-bg text-white/70 md:flex">
        <div className="px-5 py-4">
          <span className="font-display inline-flex items-center gap-2 text-base font-semibold text-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/generated/logo.jpg" alt="" width={26} height={26} className="rounded-lg" />
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

      {/* min-w-0 обязателен: без него флекс-колонка не сжимается уже своего
          содержимого, и одна широкая таблица распирает весь кабинет вбок */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line px-5 py-3 md:hidden">
          <Logo size="sm" href="/app" />
          <div className="flex items-center gap-4">
            {user.role === "ADMIN" && (
              <Link href="/app/admin" className="text-sm text-ink-500">
                Админка
              </Link>
            )}
            <form action={logoutAction}>
              <button className="text-sm text-ink-500">Выйти</button>
            </form>
          </div>
        </header>
        {/* pb-20 на мобильных — чтобы нижняя таб-панель не накрывала контент */}
        <main className="min-w-0 flex-1 bg-white p-5 pb-20 md:p-8 md:pb-8">
          {incidents.map((incident) => <div key={incident.id} className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{incident.service} сейчас недоступен. Функции, которые используют этот API, временно не работают. Администратор уже получил уведомление.</div>)}
          {children}
        </main>
      </div>

      <MobileNav items={nav} />
    </div>
  );
}
