import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EMAIL_PRESETS } from "@/lib/emailPresets";
import { deleteTemplate } from "../campaigns/actions";

const catLabels: Record<string, string> = {
  outreach: "Холодное письмо",
  announce: "Анонс",
  digest: "Дайджест",
  promo: "Промо",
  custom: "Своё (HTML)",
  "custom-text": "Своё (текст)",
};

export default async function TemplatesPage() {
  const user = await requireUser();
  const userTemplates = await prisma.emailTemplate.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900">Шаблоны писем</h1>
      <p className="mt-1 text-ink-500">
        Готовые HTML-шаблоны для контент-маркетинга. Выберите — и AI наполнит их
        текстом под ваш оффер.
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-500">
        Готовые шаблоны
      </h2>
      <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {EMAIL_PRESETS.map((p) => (
          <div
            key={p.key}
            className="overflow-hidden rounded-2xl border border-line bg-white transition hover:shadow-lg hover:shadow-slate-200/60"
          >
            <div className="relative h-56 overflow-hidden border-b border-line bg-surface">
              <iframe
                src={`/api/templates/preview?preset=${p.key}`}
                title={p.name}
                className="pointer-events-none absolute left-0 top-0 origin-top-left"
                style={{
                  width: "600px",
                  height: "700px",
                  transform: "scale(0.42)",
                }}
              />
            </div>
            <div className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-mint-600">
                {catLabels[p.category] ?? p.category}
              </div>
              <div className="mt-1 font-semibold text-slate-900">{p.name}</div>
              <div className="mt-0.5 text-xs text-ink-500 line-clamp-1">
                {p.subject}
              </div>
              <a
                href={`/app/campaigns/new?preset=${p.key}`}
                className="mt-3 block rounded-lg brand-gradient px-3 py-2 text-center text-sm font-semibold text-white transition hover:opacity-90"
              >
                Использовать
              </a>
            </div>
          </div>
        ))}
      </div>

      {userTemplates.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Мои шаблоны
          </h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {userTemplates.map((t) => (
              <div
                key={t.id}
                className="overflow-hidden rounded-2xl border border-line bg-white"
              >
                <div className="relative h-56 overflow-hidden border-b border-line bg-surface">
                  <iframe
                    src={`/api/templates/preview?id=${t.id}`}
                    title={t.name}
                    className="pointer-events-none absolute left-0 top-0 origin-top-left"
                    style={{ width: "600px", height: "700px", transform: "scale(0.42)" }}
                  />
                </div>
                <div className="p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                    {catLabels[t.category] ?? t.category}
                  </div>
                  <div className="mt-1 font-semibold text-slate-900">{t.name}</div>
                  <div className="mt-0.5 text-xs text-ink-500 line-clamp-1">{t.subject}</div>
                  <div className="mt-3 flex gap-2">
                    <a
                      href={`/app/campaigns/new?preset=tpl:${t.id}`}
                      className="flex-1 rounded-lg brand-gradient px-3 py-2 text-center text-sm font-semibold text-white transition hover:opacity-90"
                    >
                      Использовать
                    </a>
                    <form action={deleteTemplate}>
                      <input type="hidden" name="id" value={t.id} />
                      <button
                        className="rounded-lg border border-line px-3 py-2 text-sm text-ink-500 transition hover:border-red-300 hover:text-red-500"
                        aria-label={`Удалить шаблон ${t.name}`}
                      >
                        ✕
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
