import { prisma } from "@/lib/prisma";
import { unsubscribeAction } from "./actions";

// Публичная страница отписки (переход по List-Unsubscribe из письма).
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ messageId: string }>;
}) {
  const { messageId } = await params;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { contact: true, campaign: true },
  });

  const alreadyOff =
    message && message.contact.status === "UNSUBSCRIBED";

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 text-center">
      <div className="w-full rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full brand-gradient text-xl text-white">
          ✉
        </div>
        {!message ? (
          <>
            <h1 className="text-xl font-bold text-slate-900">Ссылка недействительна</h1>
            <p className="mt-2 text-sm text-ink-500">
              Не удалось найти рассылку для этого адреса.
            </p>
          </>
        ) : alreadyOff ? (
          <>
            <h1 className="text-xl font-bold text-slate-900">Вы уже отписаны</h1>
            <p className="mt-2 text-sm text-ink-500">
              {message.contact.email} больше не получает наши письма.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-slate-900">Отписаться от рассылки?</h1>
            <p className="mt-2 text-sm text-ink-500">
              Адрес {message.contact.email} перестанет получать письма.
            </p>
            <form action={unsubscribeAction} className="mt-6">
              <input type="hidden" name="messageId" value={messageId} />
              <button className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90">
                Да, отписаться
              </button>
            </form>
          </>
        )}
      </div>
      <p className="mt-6 text-xs text-ink-500">Smailee</p>
    </div>
  );
}
