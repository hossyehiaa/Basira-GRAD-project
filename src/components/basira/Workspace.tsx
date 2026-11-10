"use client";
// Workspace — GEE-style layout: controls | map | results
// v1.3: Neon PostGIS connection status pill in the workspace header.
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Loader2, Database, Zap } from "lucide-react";
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

/** Neon PostGIS connection pill (Connected / High-Speed Engine). */
function DbStatusPill() {
  const lang = useBasira((s) => s.lang);
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/db/status")
      .then((r) => r.json())
      .then((d) => alive && setConnected(Boolean(d.connected)))
      .catch(() => alive && setConnected(false));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-bold backdrop-blur ${
        connected
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
          : "border-primary/40 bg-primary/10 text-primary"
      }`}
      title={connected ? "Neon Serverless PostgreSQL + PostGIS" : "Local high-speed engine"}
    >
      {connected ? (
        <Database className="size-3.5" />
      ) : (
        <Zap className="size-3.5" />
      )}
      {t(lang, connected ? "dbPillConnected" : "dbPillLocal")}
      {connected && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
      )}
    </span>
  );
}

export function Workspace() {
  const lang = useBasira((s) => s.lang);
  return (
    <section id="workspace" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-12">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-3xl font-extrabold tracking-tight">{t(lang, "wsTitle")}</h2>
        <DbStatusPill />
      </div>
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
