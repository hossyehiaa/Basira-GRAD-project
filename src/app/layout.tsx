import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

// ---- IBM Plex family (aerospace telemetry typography) ----
// Arabic UI: IBM Plex Sans Arabic · English UI: IBM Plex Sans
// Numbers, coordinates, metrics, dates & tables: IBM Plex Mono (tabular-nums)
const plexArabic = IBM_Plex_Sans_Arabic({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["arabic", "latin"],
  variable: "--font-plex-arabic",
  display: "swap",
});
const plexSans = IBM_Plex_Sans({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "بصيرة | Basira — منصة رصد المحاصيل بالأقمار الصناعية",
  description:
    "منصة ويب مستقلة لرسم خرائط المحاصيل ومقارنة خوارزميات التعلم الآلي وحساب المساحات والدقة — برج العرب، الإسكندرية، مصر. Standalone satellite crop-mapping platform (Sentinel-2 + ML).",
  keywords: [
    "بصيرة",
    "Basira",
    "رصد المحاصيل",
    "خرائط زراعية",
    "Sentinel-2",
    "برج العرب",
    "crop mapping",
    "remote sensing",
  ],
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "بصيرة | Basira",
    description: "منصة رصد المحاصيل بالأقمار الصناعية — Satellite Crop Intelligence",
    siteName: "Basira",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#030712",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      suppressHydrationWarning
      className={`${plexArabic.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body className="antialiased bg-background text-foreground">
        {/* Dark mode is the default theme — the space aesthetic shines on load */}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
