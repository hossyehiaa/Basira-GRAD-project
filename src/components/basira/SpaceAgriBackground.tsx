"use client";
/**
 * Basira — interactive 3D "Space meets Agriculture" orbital background.
 *
 * A GPU-friendly Canvas-2D scene (no WebGL dependency):
 *   * multi-layer parallax starfield + cosmic nebula depth
 *   * rotating 3D wireframe Earth with emerald/cyan NDVI scan grid
 *   * an orbiting Sentinel-2 satellite sweeping a spectral scan cone
 *   * subtle mouse-parallax tilt; static under prefers-reduced-motion
 *   * immersive in dark mode (default), soft atmospheric in light mode
 */
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

interface Star {
  x: number; y: number; z: number; r: number; tw: number; ph: number;
}

const EMERALD = "16, 185, 129"; // #10b981
const CYAN = "6, 182, 212"; // #06b6d4

export function SpaceAgriBackground({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0, h = 0, dpr = 1;
    let stars: Star[] = [];
    let nebula: HTMLCanvasElement | null = null;

    // mouse parallax (eased)
    let mx = 0, my = 0, tmx = 0, tmy = 0;
    const onMouse = (e: MouseEvent) => {
      tmx = (e.clientX / window.innerWidth - 0.5) * 2;
      tmy = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const buildStars = () => {
      const count = Math.min(520, Math.floor((w * h) / 3200));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: 0.35 + Math.random() * 0.65, // depth layer
        r: 0.4 + Math.random() * 1.3,
        tw: 0.4 + Math.random() * 1.6,
        ph: Math.random() * Math.PI * 2,
      }));
    };

    /** Offscreen nebula (obsidian → emerald gradients), painted once. */
    const buildNebula = (light: boolean) => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, w); c.height = Math.max(1, h);
      const g = c.getContext("2d");
      if (!g) return;
      if (light) {
        // light mode: soft atmospheric orbital haze
        const r1 = g.createRadialGradient(w * 0.78, h * 0.16, 0, w * 0.78, h * 0.16, Math.max(w, h) * 0.6);
        r1.addColorStop(0, `rgba(${EMERALD}, 0.10)`);
        r1.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = r1; g.fillRect(0, 0, w, h);
      } else {
        // deep-space obsidian → emerald gradient
        const base = g.createLinearGradient(0, 0, w, h);
        base.addColorStop(0, "#030712");
        base.addColorStop(0.55, "#041014");
        base.addColorStop(1, "#051311");
        g.fillStyle = base; g.fillRect(0, 0, w, h);
        const neb = (x: number, y: number, rad: number, rgb: string, a: number) => {
          const rg = g.createRadialGradient(x, y, 0, x, y, rad);
          rg.addColorStop(0, `rgba(${rgb}, ${a})`);
          rg.addColorStop(1, "rgba(0,0,0,0)");
          g.fillStyle = rg;
          g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        };
        neb(w * 0.82, h * 0.2, Math.max(w, h) * 0.5, EMERALD, 0.10);
        neb(w * 0.15, h * 0.85, Math.max(w, h) * 0.45, CYAN, 0.07);
        neb(w * 0.45, h * 0.05, Math.max(w, h) * 0.3, "59, 130, 246", 0.05);
      }
      nebula = c;
    };

    const resize = () => {
      const parent = canvas.parentElement;
      w = parent?.clientWidth ?? window.innerWidth;
      h = parent?.clientHeight ?? 480;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      // drawing buffer only — the CSS class pins the display size (absolute,
      // inset-0), so setting canvas.style here would fight the layout.
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      buildStars();
      buildNebula(resolvedTheme === "light");
    };

    /* ---- 3D globe helpers (orthographic projection) ---- */
    const R = () => Math.min(w, h) * 0.46;
    const globeCx = () => w * 0.78;
    const globeCy = () => h * 0.52;

    const drawGlobe = (t: number, light: boolean) => {
      const cx = globeCx() + mx * 14;
      const cy = globeCy() + my * 10;
      const r = R();
      const rot = t * 0.12; // slow rotation
      const tilt = -0.32; // axial tilt (radians)

      const project = (latDeg: number, lonDeg: number) => {
        const lat = (latDeg * Math.PI) / 180;
        const lon = (lonDeg * Math.PI) / 180 + rot;
        // sphere coords
        let x = Math.cos(lat) * Math.sin(lon);
        let y = Math.sin(lat);
        let z = Math.cos(lat) * Math.cos(lon);
        // axial tilt around X
        const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
        const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
        return { x, y: y2, z: z2 };
      };

      const strong = light ? 0.35 : 0.85;
      const faint = light ? 0.1 : 0.16;

      const drawPolyline = (
        pts: { x: number; y: number; z: number }[],
        rgb: string,
        alpha: number,
        width: number
      ) => {
        ctx.beginPath();
        let started = false;
        for (const p of pts) {
          const sx = cx + p.x * r;
          const sy = cy - p.y * r;
          if (!started) { ctx.moveTo(sx, sy); started = true; }
          else ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
        ctx.lineWidth = width;
        ctx.stroke();
      };

      // latitude circles (emerald)
      for (let lat = -60; lat <= 60; lat += 20) {
        const pts: { x: number; y: number; z: number }[] = [];
        for (let lon = 0; lon <= 360; lon += 6) pts.push(project(lat, lon));
        // split into visible/faint segments for a real wireframe feel
        drawPolyline(pts, EMERALD, faint, 1);
        const front: typeof pts = [];
        for (const p of pts) if (p.z > 0) front.push(p);
        if (front.length) drawPolyline(front, EMERALD, strong * 0.8, 1.2);
      }
      // meridians (cyan)
      for (let lon = 0; lon < 180; lon += 20) {
        const pts: { x: number; y: number; z: number }[] = [];
        for (let lat = -90; lat <= 90; lat += 5) pts.push(project(lat, lon));
        drawPolyline(pts, CYAN, faint, 1);
        const front: typeof pts = [];
        for (const p of pts) if (p.z > 0) front.push(p);
        if (front.length) drawPolyline(front, CYAN, strong * 0.7, 1.2);
      }

      // planet limb (soft double stroke = glow without shadowBlur cost)
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${EMERALD}, ${light ? 0.28 : 0.4})`;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${CYAN}, ${light ? 0.12 : 0.18})`;
      ctx.lineWidth = 6;
      ctx.stroke();

      // NDVI scan sweep: an emerald band scanning across the disc
      const sweep = 0.5 + 0.5 * Math.sin(t * 0.5);
      const bandX = cx - r + sweep * 2 * r;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
      ctx.clip();
      const grad = ctx.createLinearGradient(bandX - r * 0.16, 0, bandX + r * 0.16, 0);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.5, `rgba(${EMERALD}, ${light ? 0.12 : 0.22})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(bandX - r * 0.2, cy - r, r * 0.4, r * 2);
      ctx.restore();
    };

    const drawSatellite = (t: number, light: boolean) => {
      const cx = globeCx() + mx * 14;
      const cy = globeCy() + my * 10;
      const r = R();
      // tilted elliptical orbit
      const a = r * 1.35, b = r * 0.5;
      const ang = t * 0.55;
      const ox = Math.cos(ang) * a;
      const oy = Math.sin(ang) * b;
      const rot = -0.35; // orbit plane tilt
      const sx = cx + ox * Math.cos(rot) - oy * Math.sin(rot);
      const sy = cy + ox * Math.sin(rot) + oy * Math.cos(rot);

      // orbit path (faint)
      ctx.beginPath();
      ctx.ellipse(cx, cy, a, b, rot, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${CYAN}, ${light ? 0.14 : 0.22})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 7]);
      ctx.stroke();
      ctx.setLineDash([]);

      // spectral scan cone toward the planet (only on the near half)
      if (Math.sin(ang) < 0.93) {
        const tx = cx + (sx - cx) * 0.32;
        const ty = cy + (sy - cy) * 0.32;
        const grad = ctx.createLinearGradient(sx, sy, tx, ty);
        grad.addColorStop(0, `rgba(${CYAN}, ${light ? 0.30 : 0.42})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        const dir = Math.atan2(ty - sy, tx - sx);
        const spread = 0.16;
        const len = Math.hypot(tx - sx, ty - sy);
        ctx.lineTo(
          sx + Math.cos(dir - spread) * len,
          sy + Math.sin(dir - spread) * len
        );
        ctx.lineTo(
          sx + Math.cos(dir + spread) * len,
          sy + Math.sin(dir + spread) * len
        );
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // satellite node: glowing dot + small body
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 14);
      glow.addColorStop(0, `rgba(${CYAN}, ${light ? 0.5 : 0.75})`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = light ? "#0e7490" : "#e0f7fa";
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();
      // solar panels
      ctx.strokeStyle = `rgba(${EMERALD}, ${light ? 0.6 : 0.9})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sx - 9, sy - 4); ctx.lineTo(sx - 9, sy + 4);
      ctx.moveTo(sx + 9, sy - 4); ctx.lineTo(sx + 9, sy + 4);
      ctx.stroke();
    };

    const drawStars = (t: number, light: boolean) => {
      for (const s of stars) {
        const px = s.x + mx * 26 * s.z;
        const py = s.y + my * 18 * s.z;
        const twinkle = 0.55 + 0.45 * Math.sin(t * s.tw + s.ph);
        const alpha = (light ? 0.25 : 0.9) * s.z * twinkle;
        ctx.fillStyle =
          s.z > 0.85
            ? `rgba(209, 250, 229, ${alpha})`
            : `rgba(226, 232, 240, ${alpha * 0.85})`;
        ctx.beginPath();
        ctx.arc(px, py, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const light = resolvedTheme === "light";

    const frame = (now: number) => {
      const t = now / 1000;
      // ease mouse parallax
      mx += (tmx - mx) * 0.05;
      my += (tmy - my) * 0.05;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (nebula) ctx.drawImage(nebula, 0, 0, w, h);
      else {
        ctx.fillStyle = light ? "rgba(0,0,0,0)" : "#030712";
        ctx.fillRect(0, 0, w, h);
      }
      drawStars(t, light);
      if (w >= 640) {
        drawGlobe(t, light);
        drawSatellite(t, light);
      }
      raf = requestAnimationFrame(frame);
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener("mousemove", onMouse);

    if (reduced) {
      // single static frame for users who prefer reduced motion
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (nebula) ctx.drawImage(nebula, 0, 0, w, h);
      drawStars(0, light);
      if (w >= 640) { drawGlobe(0, light); drawSatellite(0, light); }
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onVisibility = () => {
      if (reduced) return;
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("mousemove", onMouse);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [resolvedTheme]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
