import Link from "next/link";
import { Logo } from "@/components/Logo";

export function LegalDocument({
  title,
  description,
  version,
  effectiveDate,
  children,
}: {
  title: string;
  description: string;
  version: string;
  effectiveDate: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-surface px-5 py-8 sm:py-12">
      <article className="mx-auto max-w-4xl rounded-2xl border border-line bg-white px-5 py-7 shadow-sm sm:px-10 sm:py-10">
        <div className="flex flex-col gap-6 border-b border-line pb-7 sm:flex-row sm:items-start sm:justify-between">
          <Logo />
          <nav aria-label="Юридические документы" className="flex flex-wrap gap-2 text-sm">
            <Link href="/terms" className="rounded-lg border border-line px-3 py-2 text-ink-700 transition hover:border-mint-400 hover:text-slate-900">
              Пользовательское соглашение
            </Link>
            <Link href="/offer" className="rounded-lg border border-line px-3 py-2 text-ink-700 transition hover:border-mint-400 hover:text-slate-900">
              Публичная оферта
            </Link>
            <Link href="/privacy" className="rounded-lg border border-line px-3 py-2 text-ink-700 transition hover:border-mint-400 hover:text-slate-900">
              Персональные данные
            </Link>
            <Link href="/cookies" className="rounded-lg border border-line px-3 py-2 text-ink-700 transition hover:border-mint-400 hover:text-slate-900">
              Cookies
            </Link>
          </nav>
        </div>

        <header className="border-b border-line py-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-500">{description}</p>
          <dl className="mt-5 grid gap-2 text-xs text-ink-500 sm:grid-cols-2">
            <div><dt className="inline font-medium text-ink-700">Редакция: </dt><dd className="metric-number inline">{version}</dd></div>
            <div><dt className="inline font-medium text-ink-700">Действует с: </dt><dd className="metric-number inline">{effectiveDate}</dd></div>
          </dl>
        </header>

        <div className="legal-document py-8 text-[15px] leading-7 text-ink-700 [&_a]:text-indigo-600 [&_a]:underline [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-slate-900 [&_h2:first-child]:mt-0 [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-slate-900 [&_li]:mt-2 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_p]:mt-3 [&_table]:mt-5 [&_table]:w-full [&_table]:text-left [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-3 [&_th]:bg-surface [&_th]:px-3 [&_th]:py-3 [&_th]:font-medium [&_th]:text-slate-900 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
          {children}
        </div>

        <footer className="flex flex-col gap-3 border-t border-line pt-6 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="font-medium text-indigo-600 hover:underline">← На главную</Link>
          <a href="mailto:info@smailee.ru" className="hover:text-slate-900">Вопросы по документам: info@smailee.ru</a>
        </footer>
      </article>
    </main>
  );
}
