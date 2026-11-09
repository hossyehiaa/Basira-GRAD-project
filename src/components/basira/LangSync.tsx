"use client";
// Keeps <html lang dir> in sync with the selected language (AR default → RTL)
import { useEffect } from "react";
import { useBasira } from "@/lib/basira/store";

export function LangSync() {
  const lang = useBasira((s) => s.lang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  return null;
}
