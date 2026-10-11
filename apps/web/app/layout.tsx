import "@roboshare/ui/styles.css";
import "./web.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Footer, SkipLink, TestRibbon } from "@/components/Chrome";
import { Header, Tabs } from "@/components/Header";
import { MESSAGES } from "@/i18n/messages";
import { requestLocale } from "@/i18n/server";
import { Providers } from "./providers";

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = MESSAGES[await requestLocale()];
  return { title: meta.title, description: meta.description };
}

export const viewport: Viewport = { themeColor: "#050914", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await requestLocale();
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=JetBrains+Mono:wght@400;600&family=Noto+Sans+SC:wght@400;500;700;900&display=swap"
        />
      </head>
      <body>
        <Providers locale={locale}>
          <SkipLink />
          <TestRibbon />
          <Header />
          <main id="main">{children}</main>
          <Footer />
          <Tabs />
        </Providers>
      </body>
    </html>
  );
}
