"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export function OnboardingRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const onSetup = pathname === "/app/setup";

  useEffect(() => {
    if (!onSetup) router.replace("/app/setup");
  }, [onSetup, router]);

  if (!onSetup) {
    return (
      <div className="mx-auto mt-20 max-w-md rounded-2xl border border-line bg-white p-6 text-center shadow-sm">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-mint-200 border-t-mint-700" />
        <p className="mt-4 text-sm text-ink-500">Возвращаем к первому запуску…</p>
      </div>
    );
  }

  return children;
}
