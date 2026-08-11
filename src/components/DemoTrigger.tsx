"use client";

import type { ReactNode } from "react";

export const OPEN_DEMO_EVENT = "smailee:open-demo";

export function DemoTrigger({
  children,
  className,
  source,
}: {
  children: ReactNode;
  className: string;
  source: string;
}) {
  const openDemo = () => {
    window.dispatchEvent(new CustomEvent(OPEN_DEMO_EVENT, { detail: { source } }));
  };

  return (
    <button type="button" onClick={openDemo} className={className}>
      {children}
    </button>
  );
}
