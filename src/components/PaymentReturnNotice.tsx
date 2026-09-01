"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type Status = "PENDING" | "CONFIRMED" | "FAILED" | "EXPIRED" | "NOT_FOUND";

export function PaymentReturnNotice({ status }: { status: Status }) {
  const router = useRouter();

  useEffect(() => {
    if (status !== "PENDING") return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      router.refresh();
      if (attempts >= 24) window.clearInterval(timer);
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [router, status]);

  if (status === "CONFIRMED") {
    return (
      <div className="mt-4 rounded-xl border border-mint-200 bg-mint-50 px-5 py-4 text-sm text-mint-800">
        <div className="font-semibold">Оплата подтверждена</div>
        <p className="mt-1">Тариф и срок доступа уже обновлены.</p>
      </div>
    );
  }
  if (status === "FAILED" || status === "EXPIRED") {
    return (
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        <div className="font-semibold">Оплата не завершена</div>
        <p className="mt-1">Выберите тариф ещё раз, чтобы получить новую ссылку.</p>
      </div>
    );
  }
  if (status === "NOT_FOUND") return null;
  return (
    <div className="mt-4 rounded-xl border border-mint-200 bg-mint-50 px-5 py-4 text-sm text-mint-800">
      <div className="font-semibold">Проверяем оплату</div>
      <p className="mt-1">Тариф включится автоматически после подтверждения банком. Статус обновится на этой странице.</p>
    </div>
  );
}
