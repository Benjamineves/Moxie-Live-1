import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

const display = Cormorant_Garamond({
  weight: ["300", "400"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display",
});

const dmSans = DM_Sans({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-dm",
});

export const metadata: Metadata = {
  title: "Moxie · Vessel profiles",
  description: "Registered vessel profiles — Moxie Marine Technology",
  // PWA build spec (docs/moxie_digital_pwa_spec.md) §3. manifest.json's
  // own theme_color/background_color are the ones that actually become
  // installed-app chrome — this <meta name="theme-color"> is the
  // in-browser-tab equivalent, kept identical on purpose.
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Moxie",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1f35",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${dmSans.variable} h-full`}>
      <body className="min-h-full antialiased">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
