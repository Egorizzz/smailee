import Link from "next/link";

/** Логотип Smailee: сгенерированная иконка-конверт + текст латиницей */
export function Logo({
  size = "md",
  href = "/",
}: {
  size?: "sm" | "md";
  href?: string | null;
}) {
  const dim = size === "sm" ? 28 : 34;
  const text = size === "sm" ? "text-lg" : "text-xl";

  const inner = (
    <span className="inline-flex items-center gap-2 font-bold tracking-tight">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/generated/logo-test.png"
        alt="Smailee"
        width={dim}
        height={dim}
        className="rounded-lg"
      />
      <span className={text}>Smailee</span>
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="text-slate-900 hover:opacity-80 transition">
        {inner}
      </Link>
    );
  }
  return <span className="text-slate-900">{inner}</span>;
}
