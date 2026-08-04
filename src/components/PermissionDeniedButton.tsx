"use client";

import { useState } from "react";

export function PermissionDeniedButton({ label, className = "" }: { label: string; className?: string }) {
  const [shown, setShown] = useState(false);
  return <span className="inline-flex flex-col items-start gap-1"><button type="button" onClick={() => setShown(true)} className={`cursor-not-allowed opacity-45 grayscale ${className}`}>{label}</button>{shown && <span role="alert" className="text-xs text-red-500">Недостаточно прав: обратитесь к администратору</span>}</span>;
}
