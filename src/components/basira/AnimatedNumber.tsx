"use client";
/**
 * Basira — animated number counter (aerospace-telemetry feel).
 * Counts up when it first scrolls into view, then re-animates on every
 * value change (e.g. new OA% after a run). Pairs with IBM Plex Mono +
 * `tabular-nums`.
 */
import { useEffect, useRef, useState } from "react";

export function AnimatedNumber({
  value,
  decimals = 0,
  duration = 1100,
  className = "",
  suffix = "",
}: {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef(0);
  const seenRef = useRef(false);
  const currentRef = useRef(0);
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const run = () => {
      cancelAnimationFrame(rafRef.current);
      const from = currentRef.current;
      const to = Number.isFinite(value) ? value : 0;
      if (from === to) {
        currentRef.current = to;
        setDisplay(to.toFixed(decimals));
        return;
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        const v = from + (to - from) * eased;
        currentRef.current = v;
        setDisplay(v.toFixed(decimals));
        if (p < 1) rafRef.current = requestAnimationFrame(step);
        else currentRef.current = to;
      };
      rafRef.current = requestAnimationFrame(step);
    };

    if (seenRef.current) {
      run();
      return () => cancelAnimationFrame(rafRef.current);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          seenRef.current = true;
          run();
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [value, decimals, duration]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {display}
      {suffix}
    </span>
  );
}
