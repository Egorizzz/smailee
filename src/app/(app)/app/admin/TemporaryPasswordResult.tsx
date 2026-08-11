"use client";

import { useState } from "react";

export function TemporaryPasswordResult({ password }: { password: string }) {
  const [copied, setCopied] = useState(false);

  async function copyPassword() {
    await navigator.clipboard.writeText(password);
    setCopied(true);
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-medium">Передайте этот временный пароль пользователю</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-white px-2.5 py-1.5 font-mono text-sm font-semibold text-slate-900">
          {password}
        </code>
        <button
          type="button"
          onClick={copyPassword}
          className="rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900"
        >
          {copied ? "Скопировано" : "Скопировать"}
        </button>
      </div>
    </div>
  );
}
