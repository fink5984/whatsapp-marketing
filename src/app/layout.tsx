import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DirectionProvider } from "@/components/ui/direction";
import "./globals.css";

const heebo = Heebo({ variable: "--font-heebo", subsets: ["hebrew", "latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "WhatsApp Campaign Manager", template: "%s · WhatsApp Campaign Manager" },
  description: "ניהול קמפיינים שיווקיים ב-WhatsApp Business",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafb" },
    { media: "(prefers-color-scheme: dark)", color: "#14171c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-background">
        <DirectionProvider dir="rtl">
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster position="top-center" richColors dir="rtl" />
          </TooltipProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
