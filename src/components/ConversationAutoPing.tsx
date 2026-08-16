"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { saveConversationAutoPing } from "@/app/(app)/app/inbox/actions";

type Mode = "inherit" | "enabled" | "disabled";

type Props = {
  messageId: string;
  initialMode: Mode;
  initialInterval: number;
  maxAttempts: number;
  sentAttempts: number;
  globalEnabled: boolean;
  exhausted?: boolean;
};

export function ConversationAutoPing({
  messageId,
  initialMode,
  initialInterval,
  maxAttempts,
  sentAttempts,
  globalEnabled,
  exhausted = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [intervalDays, setIntervalDays] = useState(initialInterval);
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [needsRestart, setNeedsRestart] = useState(exhausted);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 320 });
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const configured = mode === "enabled" || (mode === "inherit" && globalEnabled);
  const effective = configured && !needsRestart;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gutter = 12;
    const width = Math.min(320, window.innerWidth - gutter * 2);
    const panelHeight = panelRef.current?.offsetHeight ?? 300;
    const left = Math.min(
      Math.max(gutter, rect.left),
      Math.max(gutter, window.innerWidth - width - gutter),
    );
    const below = rect.bottom + 8;
    const top = below + panelHeight <= window.innerHeight - gutter
      ? below
      : Math.max(gutter, rect.top - panelHeight - 8);
    setPosition({ left, top, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const frame = requestAnimationFrame(updatePosition);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      cancelAnimationFrame(frame);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (open) updatePosition();
  }, [effective, open, result, updatePosition]);

  function save(nextMode: "enabled" | "disabled", closeAfterSave = false) {
    setResult(null);
    startTransition(async () => {
      const data = new FormData();
      data.set("messageId", messageId);
      data.set("mode", nextMode);
      data.set("intervalDays", String(intervalDays));
      const response = await saveConversationAutoPing(data);
      setResult(response);
      if (response.ok) {
        setMode(nextMode);
        if (nextMode === "enabled") setNeedsRestart(false);
        if (closeAfterSave) setOpen(false);
      }
    });
  }

  const label = needsRestart ? "Продолжить автопинг" : effective ? "Автопинг включён" : "Включить автопинг";

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="conversation-autoping-settings"
        className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold shadow-sm transition ${needsRestart ? "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300" : effective ? "border-mint-200 bg-mint-50 text-mint-800 hover:border-mint-300" : "border-line bg-white text-ink-700 hover:bg-surface"}`}
      >
        {label}
        <svg aria-hidden viewBox="0 0 16 16" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          id="conversation-autoping-settings"
          role="dialog"
          aria-label="Настройки автопинга"
          className="fixed z-[100] rounded-xl border border-line bg-white p-4 shadow-[0_16px_48px_rgba(15,23,42,0.16)]"
          style={position}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">{needsRestart ? "Попытки закончились" : "Автопинг"}</p>
              <p className="mt-0.5 text-xs text-ink-500">{needsRestart ? "Выберите новую частоту" : "Для этого контакта"}</p>
            </div>
            {!needsRestart && <button
              type="button"
              role="switch"
              aria-checked={effective}
              aria-label={effective ? "Выключить автопинг" : "Включить автопинг"}
              disabled={pending}
              onClick={() => save(effective ? "disabled" : "enabled")}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${effective ? "bg-mint-500" : "bg-slate-200"} disabled:opacity-50`}
            >
              <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${effective ? "translate-x-5" : "translate-x-0"}`} />
            </button>}
          </div>

          {needsRestart ? (
            <div className="mt-4 border-t border-line pt-4">
              <label className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-ink-500">Повторять каждые</span>
                <span className="flex shrink-0 items-center gap-2">
                  <input type="number" min={1} max={90} value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} className="input metric-number !w-20 shrink-0" />
                  <span className="text-sm text-ink-500">дней</span>
                </span>
              </label>
              <p className="metric-number mt-2 text-[11px] text-ink-500">Завершено {sentAttempts} из {maxAttempts} попыток</p>
              <button type="button" disabled={pending} onClick={() => save("enabled", true)} className="mt-3 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                {pending ? "Запускаем…" : "Продолжить автопинг"}
              </button>
            </div>
          ) : effective ? (
            <div className="mt-4 border-t border-line pt-4">
              <label className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-ink-500">Повторять каждые</span>
                <span className="flex shrink-0 items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={intervalDays}
                    onChange={(event) => setIntervalDays(Number(event.target.value))}
                    className="input metric-number !w-20 shrink-0"
                  />
                  <span className="text-sm text-ink-500">дней</span>
                </span>
              </label>
              <p className="metric-number mt-2 text-[11px] text-ink-500">
                Отправлено {sentAttempts} из {maxAttempts} попыток
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => save("enabled")}
                className="mt-3 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? "Сохраняем…" : "Сохранить частоту"}
              </button>
            </div>
          ) : (
            <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ink-500">
              Автопинг для этого контакта отключён.
            </p>
          )}

          <p className="mt-4 break-words rounded-lg bg-mint-50 px-3 py-2.5 text-xs leading-relaxed text-mint-800">
            Ответ клиента сразу остановит автопинг. Отправка — только по будням с 09:00 до 19:00 МСК.
          </p>
          {result?.error && <p className="mt-2 text-xs text-red-600">{result.error}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
