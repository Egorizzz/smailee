import { EMAIL_PRESETS } from "@/lib/emailPresets";

const catLabels: Record<string, string> = {
  outreach: "Холодное письмо",
  announce: "Анонс",
  digest: "Дайджест",
  promo: "Промо",
};

/**
 * Галерея реальных HTML-писем (живые iframe-превью пресетов).
 * Показывает, что Smailee — не только текст, но и дизайн письма.
 */
export function EmailGallery() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {EMAIL_PRESETS.map((p) => (
        <div
          key={p.key}
          className="group overflow-hidden rounded-2xl border border-line bg-white transition hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-100"
        >
          <div className="relative h-64 overflow-hidden border-b border-line bg-surface">
            <iframe
              src={`/api/templates/preview?preset=${p.key}`}
              title={p.name}
              loading="lazy"
              className="pointer-events-none absolute left-0 top-0 origin-top-left"
              style={{ width: "600px", height: "760px", transform: "scale(0.43)" }}
            />
          </div>
          <div className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-mint-600">
              {catLabels[p.category] ?? p.category}
            </div>
            <div className="mt-1 font-semibold text-slate-900">{p.name}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
