import Link from "next/link";

/** Логотип Smailee: иконка-конверт + фирменный гротеск (Unbounded) */
export function Logo({
  size = "md",
  href = "/",
}: {
  size?: "sm" | "md";
  href?: string | null;
}) {
  const dim = size === "sm" ? 26 : 30;
  const text = size === "sm" ? "text-base" : "text-lg";

  const inner = (
    <span className="font-display inline-flex items-center gap-2 font-semibold tracking-tight">
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
      <Link href={href} className="text-[color:var(--foreground)] hover:opacity-80 transition">
        {inner}
      </Link>
    );
  }
  return <span className="text-[color:var(--foreground)]">{inner}</span>;
}
