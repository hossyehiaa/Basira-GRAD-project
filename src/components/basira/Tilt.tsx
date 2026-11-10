"use client";
/**
 * Basira — 3D hover tilt wrapper with a moving specular highlight.
 * Applies perspective rotateX/rotateY based on the pointer position and
 * exposes --gx/--gy CSS vars for the glass specular sheen. Disabled on
 * touch devices (hover: none) via CSS.
 */
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Tilt({
  children,
  className,
  max = 6,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1000px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) translateY(-2px)`;
    el.style.setProperty("--gx", `${((px + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--gy", `${((py + 0.5) * 100).toFixed(1)}%`);
  };

  const reset = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
  };

  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={reset} className={cn("tilt-card", className)}>
      {children}
    </div>
  );
}
