import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isUnisenderLive } from "@/lib/services/unisender";
import { addSender, verifySender, deleteSender } from "./actions";

export default async function SenderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { error } = await searchParams;
  const senders = await prisma.sender.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Отправитель</h1>
      <p className="mt-1 text-ink-500">
        Адрес и домен, с которых Smailee будет отправлять письма. Для хорошей
        доставляемости нужно подтвердить DNS-записи (SPF, DKIM, DMARC).
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {!isUnisenderLive && !user.unisenderApiKey && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Провайдер отправки (Unisender Go) работает в тестовом режиме — обратитесь
          к администратору, чтобы для вашего аккаунта завели отдельный Project в
          Unisender Go (изолирует доставляемость от других клиентов).
        </div>
      )}

      <form
        action={addSender}
        className="mt-6 grid gap-3 rounded-xl border border-line bg-white p-5 sm:grid-cols-2"
      >
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Имя отправителя</span>
          <input name="fromName" placeholder="Иван из Smailee" className="input mt-2" required />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-900">Email</span>
          <input name="fromEmail" type="email" placeholder="ivan@get.example.ru" className="input mt-2" required />
        </label>
        <div className="sm:col-span-2">
          <button className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
            Добавить отправителя
          </button>
        </div>
      </form>

      <div className="mt-6 space-y-3">
        {senders.length === 0 && (
          <p className="text-sm text-ink-500">Пока нет отправителей.</p>
        )}
        {senders.map((s) => (
          <div key={s.id} className="rounded-xl border border-line bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-semibold text-slate-900">
                  {s.fromName} &lt;{s.fromEmail}&gt;
                </div>
                <div className="mt-1 text-sm text-ink-500">Домен: {s.domain}</div>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                  s.verified
                    ? "bg-mint-100 text-mint-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {s.verified ? "Подтверждён" : "Не подтверждён"}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <Badge ok={s.spfOk} label="SPF" />
              <Badge ok={s.dkimOk} label="DKIM" />
              <Badge ok={s.dmarcOk} label="DMARC" />
            </div>

            <div className="mt-4 flex gap-2">
              {!s.verified && (
                <form action={verifySender}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700">
                    Проверить DNS
                  </button>
                </form>
              )}
              <form action={deleteSender}>
                <input type="hidden" name="id" value={s.id} />
                <button className="rounded-lg px-4 py-2 text-sm text-ink-500 hover:text-red-500">
                  Удалить
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
        ok ? "bg-mint-100 text-mint-700" : "bg-surface text-ink-500"
      }`}
    >
      {ok ? "✓" : "○"} {label}
    </span>
  );
}
