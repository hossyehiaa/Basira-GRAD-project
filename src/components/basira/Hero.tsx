"use client";
// Landing hero — space command-center: 3D orbital background, brand
// statement, animated KPI counters, live/demo status banner.
// "ابدأ التحليل الآن" triggers the space-to-field tour (dive to the map).
import { useEffect, useState } from "react";
import { ArrowDown, MapPinned, Sprout, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import { PLATFORM, ALGORITHMS } from "@/lib/basira/constants";
import { getGeeHealth, type GeeHealth } from "@/lib/gee/client";
import { SpaceAgriBackground } from "./SpaceAgriBackground";
import { AnimatedNumber } from "./AnimatedNumber";
import { Tilt } from "./Tilt";

export function Hero() {
  const lang = useBasira((s) => s.lang);
  const triggerScanTour = useBasira((s) => s.triggerScanTour);
  const [health, setHealth] = useState<GeeHealth | null>(null);

  useEffect(() => {
    let alive = true;
    getGeeHealth().then((h) => alive && setHealth(h)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const stats = [
    { value: PLATFORM.aoiAreaKm2, decimals: 1, key: "statArea" as const },
    { value: 12, decimals: 0, key: "statClasses" as const },
    { value: ALGORITHMS.length, decimals: 0, key: "statAlgos" as const },
    { value: 10, decimals: 0, key: "statRes" as const },
  ];

  /** Space-to-field tour: smooth dive from the hero to the map workspace. */
  const startSpaceTour = () => {
    triggerScanTour();
    document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="home" className="hero-band relative overflow-hidden">
      {/* 3D space-to-earth orbital background (starfield + wireframe globe +
          Sentinel-2 satellite + NDVI scan sweep) */}
      <SpaceAgriBackground />

      <div className="mx-auto flex max-w-7xl flex-col items-center gap-8 px-4 pb-16 pt-14 text-center md:pt-20">
        <div className="flex flex-col items-center gap-4">
          <Badge variant="outline" className="gap-1.5 border-primary/40 bg-primary/10 px-3 py-1 text-primary backdrop-blur">
            <Sprout className="size-3.5" />
            {lang === "ar" ? PLATFORM.regionAr : PLATFORM.regionEn}
          </Badge>
          <h1 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
            {t(lang, "heroTitle")}
          </h1>
          <p className="max-w-2xl text-balance text-base leading-relaxed text-muted-foreground md:text-lg">
            {t(lang, "heroSubtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" asChild className="font-bold">
            <a href="#workspace" onClick={startSpaceTour}>
              <Rocket className="size-4" />
              {t(lang, "heroCta")}
              <ArrowDown className="size-4" />
            </a>
          </Button>
          <Button size="lg" variant="outline" asChild className="font-bold backdrop-blur">
            <a href="#algorithms">{t(lang, "heroCta2")}</a>
          </Button>
        </div>
        <p className="-mt-5 text-[11px] font-semibold text-muted-foreground/80">
          {t(lang, "heroTourHint")}
        </p>

        <dl className="grid w-full max-w-3xl grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((s) => (
            <Tilt key={s.key}>
              <div className="glass rounded-xl p-4 shadow-sm">
                <dt className="sr-only">{t(lang, s.key)}</dt>
                <dd className="flex flex-col items-center gap-0.5">
                  <span className="font-mono text-3xl font-bold tabular-nums text-primary">
                    <AnimatedNumber value={s.value} decimals={s.decimals} />
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {t(lang, s.key)}
                  </span>
                </dd>
              </div>
            </Tilt>
          ))}
        </dl>

        {health && (
          <div
            className={`glass w-full max-w-3xl rounded-xl p-4 text-start ${
              health.mode === "live"
                ? "!border-emerald-500/40 bg-emerald-500/10"
                : "!border-amber-500/40 bg-amber-500/10"
            }`}
          >
            <div className="flex items-start gap-3">
              <Badge
                className={`mt-0.5 shrink-0 ${
                  health.mode === "live"
                    ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-500"
                    : "bg-amber-500 text-amber-950 hover:bg-amber-500"
                }`}
              >
                {t(lang, health.mode === "live" ? "liveBadge" : "demoBadge")}
              </Badge>
              <p
                className={`text-sm leading-relaxed ${
                  health.mode === "live"
                    ? "text-emerald-900 dark:text-emerald-100"
                    : "text-amber-900 dark:text-amber-100"
                }`}
              >
                {t(lang, health.mode === "live" ? "liveBadgeHint" : "demoBadgeHint")}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
