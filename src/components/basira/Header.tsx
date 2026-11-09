"use client";
// Sticky header: brand, anchor navigation, language & theme toggles
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Languages, Moon, Sun, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBasira } from "@/lib/basira/store";
import { t } from "@/lib/basira/i18n";

const SECTIONS = [
  { id: "home", key: "navHome" },
  { id: "workspace", key: "navWorkspace" },
  { id: "algorithms", key: "navAlgorithms" },
  { id: "upload", key: "navUpload" },
  { id: "guide", key: "navGuide" },
] as const;

export function Header() {
  const lang = useBasira((s) => s.lang);
  const setLang = useBasira((s) => s.setLang);
  const { theme, setTheme } = useTheme();
  const [active, setActive] = useState("home");

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY + 140;
      let current = "home";
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.offsetTop <= y) current = s.id;
      }
      setActive(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4">
        <a href="#home" className="flex items-center gap-2.5" aria-label="Basira home">
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-extrabold tracking-tight">{t(lang, "brand")}</span>
            <span className="text-[11px] font-medium text-muted-foreground">
              {t(lang, "brandTag")}
            </span>
          </span>
        </a>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors hover:bg-accent hover:text-accent-foreground ${
                active === s.id ? "bg-accent text-accent-foreground" : "text-muted-foreground"
              }`}
            >
              {t(lang, s.key)}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label={lang === "ar" ? "English" : "العربية"}
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          >
            {lang === "ar" ? <Languages className="size-5" /> : <Languages className="size-5" />}
            <span className="ms-1 hidden text-xs font-bold sm:inline">{t(lang, "langBtn")}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="hidden size-5 dark:block" />
            <Moon className="size-5 dark:hidden" />
          </Button>
          <span className="hidden items-center gap-1 rounded-full bg-secondary px-3 py-1.5 text-xs font-bold text-secondary-foreground lg:flex">
            <Satellite className="size-3.5" />
            Sentinel-2 · 10m
          </span>
        </div>
      </div>
      {/* mobile nav */}
      <nav className="flex gap-1 overflow-x-auto border-t px-3 py-1.5 md:hidden" aria-label="Mobile">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold ${
              active === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {t(lang, s.key)}
          </a>
        ))}
      </nav>
    </header>
  );
}
