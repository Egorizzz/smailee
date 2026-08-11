"use client";

import { useEffect } from "react";

export function ResetLandingScroll() {
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    if (!window.location.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }

    let animationFrame = 0;

    const handleAnchorClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;

      const link = event.target.closest<HTMLAnchorElement>('a[href^="#"]');
      const href = link?.getAttribute("href");
      if (!href || href === "#") return;

      const target = document.getElementById(href.slice(1));
      if (!target) return;

      event.preventDefault();
      cancelAnimationFrame(animationFrame);

      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const start = window.scrollY;
      const headerOffset = 64;
      const destination = Math.max(
        0,
        target.getBoundingClientRect().top + start - headerOffset,
      );

      if (reduceMotion) {
        window.scrollTo({ top: destination, behavior: "instant" });
        window.history.pushState(null, "", href);
        return;
      }

      const distance = destination - start;
      const duration = 1050;
      const startedAt = performance.now();

      const animate = (now: number) => {
        const progress = Math.min((now - startedAt) / duration, 1);
        const eased =
          progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        window.scrollTo({
          top: start + distance * eased,
          behavior: "instant",
        });

        if (progress < 1) {
          animationFrame = requestAnimationFrame(animate);
        } else {
          window.history.pushState(null, "", href);
        }
      };

      animationFrame = requestAnimationFrame(animate);
    };

    document.addEventListener("click", handleAnchorClick);

    return () => {
      cancelAnimationFrame(animationFrame);
      document.removeEventListener("click", handleAnchorClick);
      window.history.scrollRestoration = previous;
    };
  }, []);

  return null;
}
