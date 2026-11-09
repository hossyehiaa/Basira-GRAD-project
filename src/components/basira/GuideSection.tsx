"use client";
// Guide section — how to switch to live processing + deployment + GEE-App alternative
import { KeyRound, Rocket, Satellite, Code2, Network } from "lucide-react";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import { PLATFORM } from "@/lib/basira/constants";

export function GuideSection() {
  const lang = useBasira((s) => s.lang);
  const steps = [
    { icon: Satellite, title: t(lang, "guideS1Title"), body: t(lang, "guideS1Body") },
    { icon: KeyRound, title: t(lang, "guideS2Title"), body: t(lang, "guideS2Body") },
    { icon: Rocket, title: t(lang, "guideS3Title"), body: t(lang, "guideS3Body") },
    { icon: Code2, title: t(lang, "guideS4Title"), body: t(lang, "guideS4Body") },
  ];

  return (
    <section id="guide" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-12">
      <h2 className="text-3xl font-extrabold tracking-tight">{t(lang, "guideTitle")}</h2>
      <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground md:text-base">
        {t(lang, "guideSubtitle")}
      </p>

      <ol className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-4 rounded-xl border bg-card p-5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
              <s.icon className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-xl border bg-card p-5">
        <h3 className="mb-3 flex items-center gap-2 text-base font-extrabold">
          <Network className="size-5 text-primary" />
          {t(lang, "guideArchTitle")}
        </h3>
        <img
          src="/architecture_diagram.png"
          alt={t(lang, "guideArchAlt")}
          className="mx-auto w-full max-w-3xl rounded-lg border"
        />
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {PLATFORM.nameEn} · {PLATFORM.nameAr} — {lang === "ar" ? PLATFORM.taglineAr : PLATFORM.taglineEn}
        </p>
      </div>
    </section>
  );
}
