"use client";

import { useRef } from "react";
import { deleteMailbox } from "./actions";

export function MailboxDeleteControl({ mailboxId, email }: { mailboxId: string; email: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-md px-2 py-1 text-xs text-ink-500 hover:text-red-600"
        aria-label={`Удалить ${email}`}
      >
        Удалить
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`delete-mailbox-${mailboxId}`}
        onClick={(event) => {
          if (event.currentTarget === event.target) event.currentTarget.close();
        }}
        className="fixed inset-0 m-auto w-[min(92vw,32rem)] rounded-2xl border border-line bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/35"
      >
        <div className="p-6 sm:p-7">
          <h3 id={`delete-mailbox-${mailboxId}`} className="text-xl font-semibold tracking-tight">
            Удалить почтовый ящик?
          </h3>
          <p className="mt-3 text-sm leading-6 text-ink-600">
            Ящик <strong className="break-all text-slate-900">{email}</strong> будет отключён от Smailee. История его прогрева также будет удалена. Это действие нельзя отменить.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-surface"
            >
              Отмена
            </button>
            <form action={deleteMailbox}>
              <input type="hidden" name="id" value={mailboxId} />
              <button type="submit" className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700">
                Удалить ящик
              </button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
