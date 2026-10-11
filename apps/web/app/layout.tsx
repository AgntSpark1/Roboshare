import "@roboshare/ui/styles.css";
import "./web.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Header, Tabs } from "@/components/Header";
import { isTestChain } from "@/env";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "RoboShare · Robotaxi 份额",
  description: "按份认购自动驾驶网约车的运营收益，USDT 按期发到你的钱包。",
};

export const viewport: Viewport = { themeColor: "#050914", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=JetBrains+Mono:wght@400;600&family=Noto+Sans+SC:wght@400;500;700;900&display=swap"
        />
      </head>
      <body>
        <a className="skip" href="#main">跳到正文</a>
        <Providers>
          {isTestChain && (
            <div className="ribbon" role="note">
              <b>测试版</b> · 使用测试 USDT，不涉及真实资金
            </div>
          )}
          <Header />
          <main id="main">{children}</main>
          <footer>
            <div className="wrap">
              <span>RoboShare · USDT 结算 · BNB Chain</span>
              <span>
                投资有风险，收益不作保证。<Link href="/risk">投资须知</Link>
              </span>
            </div>
          </footer>
          <Tabs />
        </Providers>
      </body>
    </html>
  );
}
