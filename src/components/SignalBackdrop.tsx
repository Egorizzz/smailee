type SignalBackdropProps = {
  variant?: "light" | "dark";
  flip?: boolean;
  className?: string;
};

export function SignalBackdrop({
  variant = "light",
  flip = false,
  className = "",
}: SignalBackdropProps) {
  const grid = variant === "dark"
    ? {
        backgroundImage:
          "linear-gradient(to right, rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.05) 1px, transparent 1px), radial-gradient(circle at 84% 18%, rgba(159,197,245,.16), transparent 30%), radial-gradient(circle at 12% 78%, rgba(200,255,69,.1), transparent 24%)",
        backgroundSize: "48px 48px, 48px 48px, 100% 100%, 100% 100%",
      }
    : {
        backgroundImage:
          "linear-gradient(to right, rgba(11,59,46,.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(11,59,46,.055) 1px, transparent 1px), radial-gradient(circle at 84% 18%, rgba(159,197,245,.24), transparent 28%), radial-gradient(circle at 13% 72%, rgba(115,202,170,.15), transparent 24%)",
        backgroundSize: "42px 42px, 42px 42px, 100% 100%, 100% 100%",
      };

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <div
        className="absolute inset-0"
        style={{
          ...grid,
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 14%, #000 82%, transparent 100%)",
          maskImage: "linear-gradient(to bottom, transparent 0%, #000 14%, #000 82%, transparent 100%)",
        }}
      />
      <svg
        viewBox="0 0 1440 420"
        preserveAspectRatio="none"
        className={`absolute -right-16 top-6 h-64 w-[72%] opacity-80 md:top-10 ${flip ? "-scale-x-100" : ""}`}
      >
        <path
          d="M-80 310C100 310 122 104 318 104s208 206 414 206c190 0 202-168 394-168 152 0 214 84 394 84"
          fill="none"
          stroke="#9fc5f5"
          strokeOpacity={variant === "dark" ? 0.3 : 0.48}
          strokeWidth="2"
          strokeDasharray="2 9"
          strokeLinecap="round"
        />
        <path
          d="M-40 338C130 338 166 134 330 134"
          fill="none"
          stroke="#73caaa"
          strokeOpacity={variant === "dark" ? 0.18 : 0.22}
          strokeWidth="1"
        />
        <g>
          <circle cx="318" cy="104" r="4" fill="#c8ff45" />
          <circle cx="732" cy="310" r="3.5" fill="#9fc5f5" />
          <circle cx="1126" cy="142" r="4" fill="#9fc5f5" />
        </g>
      </svg>
    </div>
  );
}
