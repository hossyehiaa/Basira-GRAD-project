"use client";
// Workspace — GEE-style layout: controls | map | results
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { ControlPanel } from "./ControlPanel";
import { ResultsPanel } from "./ResultsPanel";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";

const MapPanel = dynamic(() => import("./MapPanel"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border bg-muted md:h-[620px]">
      <Loader2 className="size-8 animate-spin text-primary" />
    </div>
  ),
});

export function Workspace() {
  const lang = useBasira((s) => s.lang);
  return (
    <section id="workspace" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-12">
      <h2 className="mb-6 text-3xl font-extrabold tracking-tight">{t(lang, "wsTitle")}</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <ControlPanel />
        </div>
        <div className="lg:col-span-5">
          <MapPanel />
        </div>
        <div className="lg:col-span-4">
          <ResultsPanel />
        </div>
      </div>
    </section>
  );
}
