"use client";
// Methodology section — "المنهجية الفضائية والبيانات" (replaces the old
// developer/deployment guide): an interactive 4-stage pipeline from orbit
// to field + the Sentinel-2 spectral bands card grid.
import { Satellite, Waves, BrainCircuit, Database } from "lucide-react";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import { PLATFORM, S2_BANDS } from "@/lib/basira/constants";
import { Tilt } from "./Tilt";

export function MethodologySection() {
  const lang = useBasira((s) => s.lang);

  const stages = [
    { icon: Satellite, title: t(lang, "methStage1Title"), body: t(lang, "methStage1Body") },
    { icon: Waves, title: t(lang, "methStage2Title"), body: t(lang, "methStage2Body") },
    { icon: BrainCircuit, title: t(lang, "methStage3Title"), body: t(lang, "methStage3Body") },
    { icon: Database, title: t(lang, "methStage4Title"), body: t(lang, "methStage4Body") },
  ];

  return (
    <section id="methodology" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-12">
      <h2 className="text-3xl font-extrabold tracking-tight">{t(lang, "methTitle")}</h2>
      <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground md:text-base">
        {t(lang, "methSubtitle")}
      </p>

      {/* ---- 4-stage pipeline ---- */}
      <div className="mt-8 grid grid-cols-1 items-stretch gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        {stages.map((s, i) => (
          <div key={i} className="contents">
            <Tilt className="h-full">
              <div className="glass relative flex h-full flex-col gap-3 rounded-xl p-5">
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-full bg-primary/12 text-primary shadow-[0_0_18px_-4px_rgba(16,185,129,0.45)]">
                    <s.icon className="size-5" />
                  </span>
                  <span className="font-mono text-xs font-bold text-muted-foreground/70">
                    0{i + 1}
                  </span>
                </div>
                <h3 className="text-sm font-extrabold leading-snug">{s.title}</h3>
                <p className="text-xs font-medium leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </div>
            </Tilt>
            {i < stages.length - 1 && (
              <div
                aria-hidden
                className="pipeline-link hidden self-center md:mx-1 md:block md:h-[2px] md:w-4 lg:w-8"
              />
            )}
          </div>
        ))}
      </div>

      {/* ---- Sentinel-2 spectral bands card grid ---- */}
      <div className="glass mt-10 rounded-xl p-5">
        <h3 className="mb-1 flex items-center gap-2 text-base font-extrabold">
          <Waves className="size-5 text-primary" />
          {t(lang, "methBandsTitle")}
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{t(lang, "methBandsNote")}</p>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {S2_BANDS.map((b) => (
            <Tilt key={b.id} max={8}>
              <div
                className="relative flex h-full flex-col gap-1.5 overflow-hidden rounded-xl border bg-card p-4"
                style={{ borderColor: `${b.color}55` }}
              >
                {/* spectral glow */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-8 end-[-16px] size-24 rounded-full opacity-25 blur-2xl"
                  style={{ backgroundColor: b.color }}
                />
                <div className="flex items-center justify-between">
                  <span
                    className="font-mono text-lg font-bold"
                    style={{ color: b.color }}
                  >
                    {b.id}
                  </span>
                  <span
                    className="size-3 rounded-full border border-white/25"
                    style={{ backgroundColor: b.color, boxShadow: `0 0 12px ${b.color}` }}
                  />
                </div>
                <p className="text-xs font-extrabold">
                  {lang === "ar" ? b.nameAr : b.nameEn}
                </p>
                <p className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {b.wavelength}
                </p>
                <span className="mt-0.5 w-fit rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
                  {b.resolution}
                </span>
                <p className="mt-1 text-[10px] font-medium leading-relaxed text-muted-foreground">
                  {lang === "ar" ? b.roleAr : b.roleEn}
                </p>
              </div>
            </Tilt>
          ))}
        </div>
        <p className="mt-4 text-center font-mono text-[11px] font-semibold text-muted-foreground">
          {PLATFORM.nameEn} · {PLATFORM.nameAr} — {PLATFORM.dataset}
        </p>
      </div>
    </section>
  );
}
