"use client";
// Basira — standalone satellite crop-intelligence platform (single-page app)
import { Header } from "@/components/basira/Header";
import { Hero } from "@/components/basira/Hero";
import { Workspace } from "@/components/basira/Workspace";
import { AlgorithmsSection } from "@/components/basira/AlgorithmsSection";
import { UploadSection } from "@/components/basira/UploadSection";
import { GuideSection } from "@/components/basira/GuideSection";
import { Footer } from "@/components/basira/Footer";
import { LangSync } from "@/components/basira/LangSync";

export default function Page() {
  return (
    <div className="flex min-h-screen flex-col">
      <LangSync />
      <Header />
      <main className="flex-1">
        <Hero />
        <Workspace />
        <AlgorithmsSection />
        <UploadSection />
        <GuideSection />
      </main>
      <Footer />
    </div>
  );
}
