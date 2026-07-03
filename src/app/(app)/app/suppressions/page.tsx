import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const reasonLabels: Record<string, string> = {
  unsubscribed: "Отписался",
  complained: "Пожаловался",
  bounced: "Не доставлено",
  manual: "Вручную",
};

export default async function SuppressionsPage() {
  const user = await requireUser();
  const list = await prisma.suppression.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Отписки и стоп-лист</h1>
      <p className="mt-1 text-ink-500">
        Этим адресам письма не отправляются: отписавшиеся, пожаловавшиеся,
        недоставленные. Это защищает репутацию домена и соблюдает 152-ФЗ.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
        {list.length === 0 ? (
          <div className="p-10 text-center text-ink-500">
            Стоп-лист пуст — это хорошо.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Причина</th>
                <th className="px-4 py-3 font-medium">Дата</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-4 py-3 text-slate-900">{s.email}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-surface px-2 py-0.5 text-xs text-ink-700">
                      {reasonLabels[s.reason] ?? s.reason}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-500">
                    {s.createdAt.toLocaleDateString("ru-RU")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
