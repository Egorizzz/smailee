"use client";

import { useState } from "react";

// Ленивый предпросмотр письма кампании с реальными переменными контакта.
// iframe грузится только при раскрытии (src=/api/templates/preview?message=<id>).
export function MessagePreview({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
      >
        {open ? "Скрыть предпросмотр" : "Предпросмотр письма"}
      </button>
      {open && (
        <iframe
          src={`/api/templates/preview?message=${messageId}`}
          title="Предпросмотр письма"
          className="mt-2 h-96 w-full rounded-lg border border-line bg-white"
        />
      )}
    </div>
  );
}
