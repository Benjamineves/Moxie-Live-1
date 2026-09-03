import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { MARKETING_HOST } from "@/lib/site-domains";
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

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host")?.replace(/^www\./, "") ?? "";
  const isMarketingHost = host === MARKETING_HOST;

  return {
    title: "Moxie · Vessel profiles",
    description: "Registered vessel profiles — Moxie Marine Technology",
    // PWA build spec (docs/moxie_digital_pwa_spec.md) §3. The root layout is
    // shared by both domains, but the PWA is moxieyacht.com only — omit the
    // manifest/apple-web-app tags on moxieyachting.com so the marketing site
    // never shows up as installable.
    ...(isMarketingHost
      ? {}
      : {
          manifest: "/manifest.json",
          appleWebApp: {
            capable: true,
            statusBarStyle: "black-translucent",
            title: "Moxie",
          },
        }),
  };
}

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
