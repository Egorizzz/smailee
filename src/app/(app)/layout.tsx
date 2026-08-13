import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { can, requireWorkspace } from "@/lib/organization";
import { Logo } from "@/components/Logo";
import { logoutAction } from "../(auth)/actions";
import { SidebarNav } from "./SidebarNav";
import type { SidebarNavItem } from "./SidebarNav";
import { AppNavIcon } from "./AppNavIcon";
import { MobileNav } from "./MobileNav";
import { prisma } from "@/lib/prisma";
import { isPlanActive, planDisplayName } from "@/lib/plans";

// Меню повторяет путь пользователя: сверху ежедневная работа, ниже система.
// Инбокс слит с Лидами; Шаблоны — шаг «Оформление» в кампании; Отписки —
// таб в Контактах; Мой бизнес и Тариф — в Настройках.
// short — подпись для нижней таб-панели на телефоне: в ячейку ~75px
// «Инфраструктура» не влезает и обрезается многоточием
const baseNav: SidebarNavItem[] = [
  { href: "/app/leads", label: "Лиды", icon: "leads", group: "work" },
  { href: "/app/campaigns", label: "Кампании", icon: "campaigns", group: "work" },
  { href: "/app/contacts", label: "Контакты", icon: "contacts", group: "work" },
  { href: "/app/mailboxes", label: "Инфраструктура", short: "Ящики", icon: "mailboxes", group: "system" },
  { href: "/app/integrations", label: "Интеграции", short: "Связи", icon: "integrations", group: "system" },
  { href: "/app/settings", label: "Настройки", icon: "settings", group: "system" },
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
  const planOwner = workspace.owner;
  const planActive = isPlanActive(planOwner.plan, planOwner.planExpiresAt);
  const canManageBilling = can(workspace, "BILLING_MANAGE");
  const incidents = workspace.role === "ORG_ADMIN"
    ? await prisma.systemApiIncident.findMany({ where: { resolvedAt: null }, orderBy: { lastFailedAt: "desc" } })
    : [];
  const nav = baseNav.filter((item) => {
    if (item.href === "/app/settings" || item.href === "/app/integrations") return workspace.role === "ORG_ADMIN";
    if (item.href === "/app/mailboxes") return can(workspace, "INFRASTRUCTURE_MANAGE");
    if (item.href === "/app/contacts") return can(workspace, "CONTACTS_VIEW") || can(workspace, "CONTACTS_MANAGE");
    if (item.href === "/app/campaigns") return can(workspace, "CAMPAIGNS_CREATE") || can(workspace, "CAMPAIGNS_VIEW_ALL") || can(workspace, "CAMPAIGNS_MANAGE_OWN") || can(workspace, "CAMPAIGNS_MANAGE_ALL");
    if (item.href === "/app/leads") return can(workspace, "LEADS_VIEW_ALL") || can(workspace, "LEADS_REPLY_OWN") || can(workspace, "LEADS_REPLY_ALL");
    return true;
  });

  return (
    <div className="flex min-h-screen items-start">
      {/* Высота сайдбара привязана к viewport, а не к длинной странице.
          Навигация прокручивается внутри; бренд и профиль всегда на месте. */}
      <aside className="sticky top-0 hidden h-screen w-[17rem] shrink-0 self-start overflow-hidden border-r border-white/[0.07] bg-dark-bg text-white/70 shadow-[16px_0_40px_rgba(8,25,21,0.08)] md:flex md:flex-col">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(circle_at_15%_0%,rgba(111,220,139,0.16),transparent_62%)]" />
        <div className="relative px-4 pb-5 pt-4">
          <Link href="/app" className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-2.5 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70">
            <span className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/generated/logo.webp" alt="" width={38} height={38} className="rounded-xl ring-1 ring-white/10" />
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-dark-bg bg-mint-400" />
            </span>
            <span className="min-w-0">
              <span className="font-display block text-[15px] font-semibold leading-tight text-white">Smailee</span>
              <span className="mt-0.5 block truncate text-[10px] font-medium uppercase tracking-[0.12em] text-white/32">AI для продаж</span>
            </span>
          </Link>
        </div>
        <SidebarNav items={nav} />
        {user.role === "ADMIN" && (
          <div className="px-3 pb-3">
            <Link
              href="/app/admin"
              className="flex min-h-10 items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-sm font-medium text-white/65 transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              <AppNavIcon name="admin" className="h-4 w-4" />
              Админка
            </Link>
          </div>
        )}
        <div className="relative border-t border-white/[0.07] bg-black/10 p-3">
          <div className="mb-2 flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-1.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-mint-300/25 to-mint-500/10 text-xs font-semibold uppercase text-mint-200 ring-1 ring-mint-300/15">{(user.name || user.email).slice(0, 1)}</span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-white/75">{user.name || user.email}</span>
              <span className="mt-0.5 block truncate text-[10px] text-white/30">{workspace.organizationName}</span>
            </span>
          </div>
          <form action={logoutAction}>
            <button className="flex min-h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left text-xs font-medium text-white/42 transition-colors hover:bg-white/[0.05] hover:text-white/75">
              <AppNavIcon name="logout" className="h-4 w-4" />
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
          {planOwner.role === "CLIENT" && (
            <div className={`mb-4 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${planActive ? "border-mint-200 bg-mint-50 text-mint-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              <div>
                <span className="font-semibold">{planDisplayName(planOwner)}</span>
                {planOwner.planExpiresAt && (
                  <span> · {planActive ? "действует" : "действовал"} до {planOwner.planExpiresAt.toLocaleDateString("ru-RU")}</span>
                )}
                {!planActive && <span> · запуск и отправка кампаний приостановлены</span>}
              </div>
              {canManageBilling ? (
                <Link href="/app/billing" className="shrink-0 font-semibold underline underline-offset-2">
                  {planActive ? "Тариф и оплата" : "Выбрать тариф"}
                </Link>
              ) : !planActive ? (
                <span className="shrink-0 text-xs">Обратитесь к администратору организации</span>
              ) : null}
            </div>
          )}
          {incidents.map((incident) => <div key={incident.id} className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{incident.service} сейчас недоступен. Функции, которые используют этот API, временно не работают. Администратор уже получил уведомление.</div>)}
          {children}
        </main>
      </div>

      <MobileNav items={nav} />
    </div>
  );
}
