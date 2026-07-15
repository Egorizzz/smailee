"use client";

import { useEffect, useRef, useState } from "react";

/** Число считается один раз при попадании в вьюпорт (900ms, ease-out). Остальное — статичный текст вокруг. */
export function Counter({
  to,
  prefix = "",
  suffix = "",
  duration = 900,
}: {
  to: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    function run() {
      if (started.current) return;
      started.current = true;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        setValue(Math.round(to * eased));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    if (!el || typeof IntersectionObserver === "undefined") {
      run(); // нет API — не оставляем число нулём навсегда
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          run();
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    // страховка: если наблюдатель (или сам requestAnimationFrame — браузеры
    // легитимно приостанавливают его в фоновых/невидимых вкладках) не
    // сработал — не оставляем 0 навсегда, сразу показываем финальное число
    const fallback = setTimeout(() => {
      if (!started.current) {
        started.current = true;
        setValue(to);
      }
    }, 1500);
    return () => {
      io.disconnect();
      clearTimeout(fallback);
    };
  }, [to, duration]);

  return (
    <span ref={ref} className="font-mono tabular">
      {prefix}
      {value.toLocaleString("ru-RU")}
      {suffix}
    </span>
  );
}
