"use client";

import { cancelAutoRenewal } from "@/app/(app)/app/billing/actions";

export function CancelAutoRenewalButton() {
  return (
    <form
      action={cancelAutoRenewal}
      onSubmit={(event) => {
        if (!window.confirm("Отключить автоматическое продление? Оплаченный доступ сохранится до указанной даты.")) {
          event.preventDefault();
        }
      }}
    >
      <button className="text-sm font-medium text-ink-600 underline decoration-ink-300 underline-offset-4 hover:text-slate-900">
        Отключить автопродление
      </button>
    </form>
  );
}
