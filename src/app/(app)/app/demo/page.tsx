import { redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/lib/organization";
import { getDemoWorkspace } from "@/lib/demoWorkspace";
import { prisma } from "@/lib/prisma";
import { DemoGenerationScreen } from "./DemoGenerationScreen";
import { DemoWorkspaceSetupForm } from "./DemoWorkspaceSetupForm";

export default async function DemoOnboardingPage() {
  const workspace = await requireOrganizationAdmin();
  const demo = await getDemoWorkspace(workspace.organizationId);
  if (!demo || demo.status === "DISABLED") redirect("/app/analytics");
  if (demo.status === "ACTIVE") redirect("/app/analytics");
  if (demo.status === "GENERATING") {
    const crawl = await prisma.websiteCrawl.findFirst({
      where: { organizationId: workspace.organizationId! },
      orderBy: { createdAt: "desc" },
      select: { status: true, discoveredCount: true, crawledCount: true, analyzedCount: true, failedCount: true, pageLimit: true, error: true },
    });
    return <DemoGenerationScreen initial={{ demoStatus: demo.status, lastError: demo.lastError, crawl }} />;
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-13rem)] max-w-5xl items-center py-8">
      <section className="grid w-full overflow-hidden rounded-2xl border border-line bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)] lg:grid-cols-[1.05fr_0.95fr]">
        <div className="p-7 sm:p-10 lg:p-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-mint-200 bg-mint-50 px-3 py-1 text-xs font-semibold text-mint-800">
            <span className="h-2 w-2 rounded-full bg-mint-500" />
            Без реальных отправок
          </div>
          <h1 className="mt-6 max-w-xl text-3xl font-semibold leading-tight tracking-[-0.03em] text-slate-950 sm:text-4xl">
            Сначала посмотрите Smailee на готовой кампании
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-500">
            Мы соберём безопасную песочницу: контакты, пять кампаний, воронку, ответы клиентов и виртуальный флот. Ничего не уйдёт во внешние системы.
          </p>

          <DemoWorkspaceSetupForm defaultWebsite={demo.websiteUrl ?? ""} />

          {demo.status === "FAILED" && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {demo.lastError || "Демо не собралось с первого раза. Повторите запуск или оставьте сайт пустым, чтобы использовать стандартный профиль."}
            </div>
          )}
        </div>

        <div className="border-t border-line bg-[#f4f8f5] p-7 sm:p-10 lg:border-l lg:border-t-0 lg:p-12">
          <p className="text-sm font-semibold text-slate-900">Что появится в кабинете</p>
          <div className="mt-5 space-y-3">
            {[
              ["900", "контактов с сегментами и данными компаний"],
              ["5", "кампаний на сотни получателей"],
              ["5–7", "персонализированных примеров в каждой кампании"],
              ["2–4", "примеров ответов клиентов в Inbox"],
            ].map(([value, label]) => (
              <div key={label} className="flex items-center gap-4 rounded-xl border border-mint-100 bg-white px-4 py-3">
                <span className="metric-number w-12 shrink-0 text-xl font-semibold text-mint-800">{value}</span>
                <span className="text-sm leading-snug text-ink-700">{label}</span>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs leading-relaxed text-ink-500">
            Остальные письма представлены в статистике кампании и будут персонализированы только при рабочем запуске. Это сохраняет ресурсы и показывает реальный UX без сотен лишних генераций.
          </p>
        </div>
      </section>
    </div>
  );
}
