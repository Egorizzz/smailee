import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadContacts, clearContacts } from "./actions";

export default async function ContactsPage() {
  const user = await requireUser();
  const [total, contacts, segments] = await Promise.all([
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
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900">База контактов</h1>
      <p className="mt-1 text-ink-500">
        Загрузите CSV с контактами. Нужна колонка <code>email</code>; опционально:{" "}
        <code>name</code>, <code>company</code>, <code>segment</code>.
      </p>

      <form
        action={uploadContacts}
        className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white p-5"
      >
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="text-sm"
        />
        <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
          Загрузить
        </button>
      </form>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <div className="rounded-xl border border-line bg-white px-5 py-3">
          <div className="text-2xl font-bold text-slate-900">{total}</div>
          <div className="text-sm text-ink-500">контактов всего</div>
        </div>
        {segments
          .filter((s) => s.segment)
          .map((s) => (
            <div
              key={s.segment}
              className="rounded-lg bg-surface px-3 py-2 text-sm text-ink-700"
            >
              {s.segment}: <b>{s._count}</b>
            </div>
          ))}
        {total > 0 && (
          <form action={clearContacts} className="ml-auto">
            <button className="text-sm text-ink-500 hover:text-red-500">
              Очистить базу
            </button>
          </form>
        )}
      </div>

      {contacts.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
          <table className="w-full text-left text-sm">
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
          {total > 100 && (
            <div className="border-t border-line px-4 py-3 text-xs text-ink-500">
              Показаны первые 100 из {total}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
