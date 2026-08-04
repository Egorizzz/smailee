import Link from "next/link";
import { can, requireCapability } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { clearContacts, releaseSuppression } from "./actions";
import { ContactsImport } from "@/components/ContactsImport";
import { PermissionDeniedButton } from "@/components/PermissionDeniedButton";

/**
 * Контакты (TO BE, R1): база + сегменты + таб «Отписки» (бывшая отдельная
 * вкладка «Отписки» — редкий сценарий, живёт внутри Контактов).
 */

const reasonLabels: Record<string, string> = {
  unsubscribed: "Отписался", // старый механизм — ссылку больше не рассылаем
  declined_via_reply: "Отказался в переписке",
  complained: "Пожаловался",
  bounced: "Не доставлено",
  manual: "Вручную",
};

// Через сколько дней в стоп-листе кнопка «Вернуть в базу» перестаёт быть
// приглушённой — раньше этого срока тоже можно нажать, просто без нажима
// в интерфейсе: человек только что отказался, скорее всего рано.
const RELEASE_SUGGESTED_AFTER_DAYS = 180;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tab?: string }>;
}) {
  const workspace = await requireCapability("CONTACTS_VIEW");
  const user = workspace.owner;
  const canManage = can(workspace, "CONTACTS_MANAGE");
  const { error, tab } = await searchParams;
  const activeTab = tab === "suppressions" ? "suppressions" : "contacts";

  const [total, contacts, segments, suppressions] = await Promise.all([
    prisma.contact.count({ where: { userId: user.id } }),
    prisma.contact.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.contact.groupBy({
      by: ["segment"],
      where: { userId: user.id },
      _count: true,
    }),
    // только активные — вернутых оператором показывать не нужно, они уже
    // снова обычные контакты (история остаётся в БД, просто не в этом списке)
    prisma.suppression.findMany({
      where: { userId: user.id, releasedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900">Контакты</h1>
      <p className="mt-1 text-ink-500">
        База получателей и стоп-лист. Загрузите таблицу в любом формате —
        система сама разберёт колонки и покажет разметку до импорта.
      </p>

      {/* табы */}
      <div className="mt-5 flex gap-2 border-b border-line">
        {[
          { key: "contacts", href: "/app/contacts", label: `База · ${total}` },
          {
            key: "suppressions",
            href: "/app/contacts?tab=suppressions",
            label: `Отписки и стоп-лист · ${suppressions.length}`,
          },
        ].map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              activeTab === t.key
                ? "border-mint-500 text-slate-900"
                : "border-transparent text-ink-500 hover:text-slate-900"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {activeTab === "contacts" ? (
        <>
          <div className="mt-6">
            {canManage ? <ContactsImport /> : <PermissionDeniedButton label="Импортировать контакты" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-700" />}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <div className="rounded-xl border border-line bg-white px-5 py-3">
              <div className="text-2xl font-bold text-slate-900">{total}</div>
              <div className="text-sm text-ink-500">контактов всего</div>
            </div>
            {segments
              .filter((s) => s.segment)
              .map((s) => (
                <div key={s.segment} className="rounded-lg bg-surface px-3 py-2 text-sm text-ink-700">
                  {s.segment}: <b>{s._count}</b>
                </div>
              ))}
            {total > 0 && (canManage ? (
              <form action={clearContacts} className="ml-auto">
                <button className="text-sm text-ink-500 hover:text-red-500">Очистить базу</button>
              </form>
            ) : <div className="ml-auto"><PermissionDeniedButton label="Очистить базу" className="text-sm text-ink-500" /></div>)}
          </div>

          {contacts.length > 0 && (
            <div className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
              <div className="scroll-x">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-surface text-ink-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Имя</th>
                    <th className="px-4 py-3 font-medium">Компания</th>
                    <th className="px-4 py-3 font-medium">Сегмент</th>
                    <th className="px-4 py-3 font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id} className="border-t border-line">
                      <td className="px-4 py-3 text-slate-900">{c.email}</td>
                      <td className="px-4 py-3 text-ink-700">{c.name ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-700">{c.company ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-700">{c.segment ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-mint-100 px-2 py-0.5 text-xs text-mint-700">
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {total > 100 && (
                <div className="border-t border-line px-4 py-3 text-xs text-ink-500">
                  Показаны первые 100 из {total}.
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-5 text-sm text-ink-500">
            Этим адресам письма не отправляются: попросили прекратить писать
            (прямо в переписке — ИИ распознаёт это сам), пожаловались или
            письмо не доставлено. Общий стоп-лист на аккаунт, не на кампанию:
            попадает один раз — не получает писем ни из одной рассылки.
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-white">
            {suppressions.length === 0 ? (
              <div className="p-10 text-center text-ink-500">Стоп-лист пуст — это хорошо.</div>
            ) : (
              <div className="scroll-x">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="bg-surface text-ink-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Причина</th>
                    <th className="px-4 py-3 font-medium">Дата</th>
                    <th className="px-4 py-3 font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {suppressions.map((s) => {
                    const daysAgo = Math.floor((Date.now() - s.createdAt.getTime()) / 86_400_000);
                    const suggested = daysAgo >= RELEASE_SUGGESTED_AFTER_DAYS;
                    return (
                      <tr key={s.id} className="border-t border-line">
                        <td className="px-4 py-3 text-slate-900">{s.email}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-md bg-surface px-2 py-0.5 text-xs text-ink-700">
                            {reasonLabels[s.reason] ?? s.reason}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-ink-500">
                          {s.createdAt.toLocaleDateString("ru-RU")}
                          {suggested && (
                            <span className="ml-1.5 text-xs text-ink-500">· {daysAgo} дн. назад</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {canManage ? <form action={releaseSuppression}>
                            <input type="hidden" name="id" value={s.id} />
                            <button
                              className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                                suggested
                                  ? "border-mint-200 bg-mint-100 text-mint-700"
                                  : "border-line text-ink-500 hover:text-slate-900"
                              }`}
                              title={
                                suggested
                                  ? `В стоп-листе ${daysAgo} дней — возможно, стоит попробовать снова`
                                  : "Вернуть контакт в рассылку"
                              }
                            >
                              Вернуть в базу
                            </button>
                          </form> : <PermissionDeniedButton label="Вернуть в базу" className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-500" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
