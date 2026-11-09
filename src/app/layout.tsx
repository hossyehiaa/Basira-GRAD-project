import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
