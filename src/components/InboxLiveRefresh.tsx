"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

const INBOX_REFRESH_INTERVAL_MS = 5_000;

export function InboxLiveRefresh() {
  const router = useRouter();
  const [refreshPending, startRefresh] = useTransition();
  const refreshPendingRef = useRef(refreshPending);

  useEffect(() => {
    refreshPendingRef.current = refreshPending;
  }, [refreshPending]);

  useEffect(() => {
    let unlockTimer: number | undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible" || navigator.onLine === false || refreshPendingRef.current) return;
      refreshPendingRef.current = true;
      startRefresh(() => router.refresh());
      window.clearTimeout(unlockTimer);
      unlockTimer = window.setTimeout(() => {
        refreshPendingRef.current = false;
      }, INBOX_REFRESH_INTERVAL_MS);
    };

    const interval = window.setInterval(refresh, INBOX_REFRESH_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(unlockTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [router]);

  return null;
}
