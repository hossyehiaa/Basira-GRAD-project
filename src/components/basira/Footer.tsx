"use client";
// Sticky footer — shows the real processing mode (live GEE / demo)
import { useEffect, useState } from "react";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";
import { PLATFORM } from "@/lib/basira/constants";
import { getGeeHealth } from "@/lib/gee/client";

export function Footer() {
  const lang = useBasira((s) => s.lang);
  const [live, setLive] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    getGeeHealth()
      .then((h) => alive && setLive(h.mode === "live"))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <footer className="mt-auto border-t bg-card">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 py-6 text-center">
        <div className="flex items-center gap-2">
          <span className="text-base font-extrabold">
            {t(lang, "brand")} · {t(lang, "brandTag")}
          </span>
        </div>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          {t(lang, "footerMade")}
        </p>
        <p className="text-[11px] font-semibold text-muted-foreground">
          © {new Date().getFullYear()} {t(lang, "brand")} — {t(lang, "footerRights")}
          {live !== null && ` · ${t(lang, live ? "footerLive" : "footerDemo")}`} · v
          {PLATFORM.version}
        </p>
      </div>
    </footer>
  );
}
